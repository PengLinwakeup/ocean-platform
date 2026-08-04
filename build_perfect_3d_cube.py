import os
import cv2
import numpy as np
import xarray as xr
import matplotlib.pyplot as plt
import matplotlib.colors as mcolors
import matplotlib.ticker as mticker
import cartopy.crs as ccrs
import cartopy.feature as cfeature
from PIL import Image, ImageDraw, ImageFont
import sys

sys.stdout.reconfigure(encoding='utf-8')

print("1. Extracting clean Top Map and Colorbar from User Image...")
user_img_path = r'C:\Users\Windows\.gemini\antigravity-ide\brain\a79f783e-9686-45f4-a2f0-5aacae89af16\media__1785803299908.png'
user_img = Image.open(user_img_path).convert('RGBA')
W_orig, H_orig = user_img.size

# Crop Top Map rectangle ONLY (excluding colorbar)
# Map bounds: left=23, top=21, right=991, bottom=455
top_map_crop = user_img.crop((23, 21, 991, 455))
top_map_crop.save('clean_top_map.png')
w_map, h_map = top_map_crop.size
print(f"Clean Top Map dimensions: {w_map}x{h_map}")

# Crop Top Colorbar ONLY
top_cbar_crop = user_img.crop((230, 455, 780, 535))
top_cbar_crop.save('clean_top_cbar.png')

# ==========================================
# 2. Render Matching Clean Bottom OMZ Map (NO Colorbar inside frame)
# ==========================================
print("2. Rendering Matching Clean Bottom OMZ Map...")
ds_omz = xr.open_dataset('data/woa18_omz_min_extracted.nc', decode_times=False)
lats_omz = ds_omz['lat'].values
lons_omz = ds_omz['lon'].values
o2_data = ds_omz['omz_min'].values

lon_grid, lat_grid = np.meshgrid(lons_omz, lats_omz)

fig = plt.figure(figsize=(w_map / 100.0, h_map / 100.0), dpi=300)
ax = fig.add_axes([0, 0, 1, 1], projection=ccrs.PlateCarree())
ax.set_extent([-180, 180, -70, 75], crs=ccrs.PlateCarree())

cmap_o2 = plt.colormaps['Spectral_r'] # Reversed Spectral colormap (Red for OMZ hypoxia)

mesh = ax.pcolormesh(
    lon_grid, lat_grid, o2_data,
    cmap=cmap_o2, vmin=0, vmax=250,
    transform=ccrs.PlateCarree(), zorder=1
)

# Land feature & white outline matching user map
ax.add_feature(cfeature.LAND, facecolor='#E5ECF6', edgecolor='white', linewidth=0.8, zorder=2)
ax.add_feature(cfeature.COASTLINE, linewidth=0.8, edgecolor='white', zorder=3)

# Gridlines
gl = ax.gridlines(
    crs=ccrs.PlateCarree(), draw_labels=True,
    linewidth=0.5, color='#94a3b8', alpha=0.6, linestyle=':'
)
gl.top_labels = False
gl.right_labels = False
gl.left_labels = True
gl.bottom_labels = True

gl.xlocator = mticker.FixedLocator([-180, -150, -120, -90, -60, -30, 0, 30, 60, 90, 120, 150, 180])
gl.ylocator = mticker.FixedLocator([-60, -40, -20, 0, 20, 40, 60])
gl.xlabel_style = {'size': 8, 'color': '#475569'}
gl.ylabel_style = {'size': 8, 'color': '#475569'}

bot_map_path = 'clean_bottom_map.png'
plt.savefig(bot_map_path, dpi=300, pad_inches=0, facecolor='white')
plt.close()

# Also render standalone Bottom Colorbar
fig_cb = plt.figure(figsize=(6, 1.2), dpi=300)
ax_cb = fig_cb.add_axes([0.05, 0.45, 0.9, 0.35])
cbar_bot = fig_cb.colorbar(mesh, cax=ax_cb, orientation='horizontal', extend='both')
cbar_bot.set_label('Dissolved Oxygen Minimum ($\mu\mathrm{mol\ kg^{-1}}$, WOA18 Climatology)', fontsize=10, labelpad=4)
cbar_bot.ax.tick_params(labelsize=9)
bot_cbar_path = 'clean_bottom_cbar.png'
plt.savefig(bot_cbar_path, dpi=300, bbox_inches='tight', transparent=True)
plt.close()

# ==========================================
# 3. Composite 3D Perspective Ocean Cube
# ==========================================
print("3. Compositing 3D Isometric View...")

img_top_map = cv2.imread('clean_top_map.png', cv2.IMREAD_UNCHANGED)
img_bot_map = cv2.imread('clean_bottom_map.png', cv2.IMREAD_UNCHANGED)

# Ensure RGBA
if img_top_map.shape[2] == 3:
    img_top_map = cv2.cvtColor(img_top_map, cv2.COLOR_BGR2BGRA)
if img_bot_map.shape[2] == 3:
    img_bot_map = cv2.cvtColor(img_bot_map, cv2.COLOR_BGR2BGRA)

# Canvas
W, H = 2600, 1600
canvas = np.zeros((H, W, 4), dtype=np.uint8)

# Dark Slate Background Gradient
for y in range(H):
    r = int(14 + (28 - 14) * (y / H))
    g = int(30 + (45 - 30) * (y / H))
    b = int(45 + (62 - 45) * (y / H))
    canvas[y, :, :] = [r, g, b, 255]

# Define 3D Skew Planes for MAPS ONLY
src_map_pts = np.float32([[0, 0], [w_map, 0], [w_map, h_map], [0, h_map]])

# Top Map 3D plane coords
top_dst_pts = np.float32([
    [240,  160],  # Top-Left
    [2360, 160],  # Top-Right
    [2520, 620],  # Bottom-Right
    [80,   620]   # Bottom-Left
])

# Bottom Map 3D plane coords
bot_dst_pts = np.float32([
    [240,  740],  # Top-Left
    [2360, 740],  # Top-Right
    [2520, 1200], # Bottom-Right
    [80,   1200]  # Bottom-Left
])

M_top = cv2.getPerspectiveTransform(src_map_pts, top_dst_pts)
M_bot = cv2.getPerspectiveTransform(src_map_pts, bot_dst_pts)

warped_top_map = cv2.warpPerspective(img_top_map, M_top, (W, H))
warped_bot_map = cv2.warpPerspective(img_bot_map, M_bot, (W, H))

def overlay(bg, fg):
    alpha = fg[:, :, 3] / 255.0
    for c in range(3):
        bg[:, :, c] = (1.0 - alpha) * bg[:, :, c] + alpha * fg[:, :, c]
    return bg

canvas = overlay(canvas, warped_bot_map)
canvas = overlay(canvas, warped_top_map)

pil_img = Image.fromarray(canvas)
draw = ImageDraw.Draw(pil_img)

# Helper function to project map coords to warped canvas
def project_pt(lon, lat, M):
    # Normalized coords inside the 2D ocean map frame
    # Extent: lon [-180, 180], lat [-70, 75]
    x_in_map = (lon + 180.0) / 360.0 * w_map
    y_in_map = (75.0 - lat) / (75.0 - (-70.0)) * h_map
    
    pt = np.array([[[x_in_map, y_in_map]]], dtype=np.float32)
    warped = cv2.perspectiveTransform(pt, M)
    return float(warped[0, 0, 0]), float(warped[0, 0, 1])

# Draw 3D Vertical Drop Lines (Pillars) along 25°S Cruise Track
stations_lon = [40, 52, 65, 78, 92, 105, 114]
stations_lat = -25.0

for st_lon in stations_lon:
    x_t, y_t = project_pt(st_lon, stations_lat, M_top)
    x_b, y_b = project_pt(st_lon, stations_lat, M_bot)
    
    # Dashed vertical pillar line
    segments = 25
    for seg in range(segments):
        if seg % 2 == 0:
            y1 = y_t + (y_b - y_t) * (seg / segments)
            y2 = y_t + (y_b - y_t) * ((seg + 1) / segments)
            x1 = x_t + (x_b - x_t) * (seg / segments)
            x2 = x_t + (x_b - x_t) * ((seg + 1) / segments)
            draw.line([(x1, y1), (x2, y2)], fill=(255, 255, 255, 220), width=2)
            
    # Station dots
    draw.ellipse([x_t-4, y_t-4, x_t+4, y_t+4], fill=(225, 29, 72, 255), outline=(255, 255, 255, 255))
    draw.ellipse([x_b-4, y_b-4, x_b+4, y_b+4], fill=(255, 255, 255, 230))

# Side Depth Axis Labels
draw.text((25, 600), "0m\nSurface", fill=(224, 231, 255), font_size=22)
draw.text((25, 910), "~500m\nOMZ Core\nDepth", fill=(224, 231, 255), font_size=22)
draw.text((25, 1190), "~2000m", fill=(224, 231, 255), font_size=22)

# Overlay Colorbars (Top Colorbar above 3D block, Bottom Colorbar below 3D block)
top_cbar_img = Image.open('clean_top_cbar.png').convert('RGBA')
top_cbar_img = top_cbar_img.resize((1100, 150))
pil_img.paste(top_cbar_img, (750, 10), top_cbar_img)

bot_cbar_img = Image.open('clean_bottom_cbar.png').convert('RGBA')
bot_cbar_img = bot_cbar_img.resize((1200, 160))
pil_img.paste(bot_cbar_img, (700, 1380), bot_cbar_img)

# Save final perfect 3D image
perfect_output = "perfect_3d_ocean_cube.png"
pil_img.save(perfect_output)
print(f"4. Successfully generated PERFECT 3D Ocean Cube at: {perfect_output}")
