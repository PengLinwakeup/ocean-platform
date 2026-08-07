import os
import cv2
import numpy as np
import xarray as xr
import matplotlib.pyplot as plt
import matplotlib.colors as mcolors
import cartopy.crs as ccrs
import cartopy.feature as cfeature
from PIL import Image, ImageDraw, ImageFont

# Set UTF-8 encoding
import sys
sys.stdout.reconfigure(encoding='utf-8')

print("1. Loading real NetCDF data (WOA18 Oxygen Minimum & MODIS Chlorophyll-a)...")
ds_omz = xr.open_dataset('data/woa18_omz_min_extracted.nc', decode_times=False)
ds_chl = xr.open_dataset('data/surface_chlorophyll_1deg.nc', decode_times=False)

lats_omz = ds_omz['lat'].values
lons_omz = ds_omz['lon'].values
o2_data = ds_omz['omz_min'].values # shape (180, 360)

lats_chl = ds_chl['latitude'].values
lons_chl = ds_chl['longitude'].values
chl_raw = ds_chl['chlorophyll'].values.squeeze()

# Align longitude / latitude grids
lon_grid, lat_grid = np.meshgrid(lons_omz, lats_omz)

# Re-grid chlorophyll to match 180x360
chl_data = np.zeros((180, 360))
chl_data[:, :359] = chl_raw
chl_data[:, 359] = chl_raw[:, -1]
chl_data = np.clip(chl_data, 0.04, 3.16)

# ==========================================
# 2. Render Top Layer: Surface Chlorophyll-a (Cartopy)
# ==========================================
print("2. Rendering Top Map Layer (Surface Chlorophyll-a)...")
fig1 = plt.figure(figsize=(14, 7), dpi=300)
ax1 = fig1.add_subplot(1, 1, 1, projection=ccrs.PlateCarree())
ax1.set_global()

mesh1 = ax1.pcolormesh(
    lon_grid, lat_grid, chl_data,
    cmap='inferno',
    transform=ccrs.PlateCarree(),
    norm=mcolors.LogNorm(vmin=0.04, vmax=3.16)
)

# Land mask & coastlines
ax1.add_feature(cfeature.LAND, facecolor='#E2E8F0', zorder=2)
ax1.add_feature(cfeature.COASTLINE, linewidth=0.6, edgecolor='#475569', zorder=3)

# Gridlines
gl1 = ax1.gridlines(
    crs=ccrs.PlateCarree(), draw_labels=True,
    linewidth=0.5, color='white', alpha=0.5, linestyle='--'
)
gl1.top_labels = False
gl1.right_labels = False
gl1.bottom_labels = False
gl1.left_labels = False

# 25°S Cruise Track
track_lons = np.linspace(35, 115, 35)
track_lats = -25 + 1.5 * np.sin(np.linspace(0, 8, 35))
ax1.plot(
    track_lons, track_lats,
    color='#E11D48', linewidth=1.8,
    marker='o', markerfacecolor='white', markersize=3.5,
    transform=ccrs.PlateCarree(), zorder=4,
    label='$25^\\circ$S Cruise Track'
)
ax1.legend(loc='lower left', frameon=True, facecolor='white', framealpha=0.85, fontsize=10)

plt.subplots_adjust(left=0, right=1, top=1, bottom=0)
top_img_path = 'top_layer_chl.png'
plt.savefig(top_img_path, dpi=300, bbox_inches='tight', pad_inches=0, transparent=True)
plt.close()

# ==========================================
# 3. Render Bottom Layer: Dissolved Oxygen Minimum (Cartopy)
# ==========================================
print("3. Rendering Bottom Map Layer (Dissolved Oxygen Minimum)...")
fig2 = plt.figure(figsize=(14, 7), dpi=300)
ax2 = fig2.add_subplot(1, 1, 1, projection=ccrs.PlateCarree())
ax2.set_global()

# Custom Oxygen Colormap (Spectral_r)
cmap_o2 = plt.colormaps['Spectral_r']

mesh2 = ax2.pcolormesh(
    lon_grid, lat_grid, o2_data,
    cmap=cmap_o2, vmin=0, vmax=250,
    transform=ccrs.PlateCarree()
)

# Land mask & coastlines
ax2.add_feature(cfeature.LAND, facecolor='#E2E8F0', zorder=2)
ax2.add_feature(cfeature.COASTLINE, linewidth=0.6, edgecolor='#475569', zorder=3)

# Gridlines
gl2 = ax2.gridlines(
    crs=ccrs.PlateCarree(), draw_labels=True,
    linewidth=0.5, color='gray', alpha=0.3, linestyle='--'
)
gl2.top_labels = False
gl2.right_labels = False
gl2.bottom_labels = False
gl2.left_labels = False

plt.subplots_adjust(left=0, right=1, top=1, bottom=0)
bot_img_path = 'bottom_layer_omz.png'
plt.savefig(bot_img_path, dpi=300, bbox_inches='tight', pad_inches=0, transparent=True)
plt.close()

# ==========================================
# 4. Composite 3D Perspective Box
# ==========================================
print("4. Compositing 3D Isometric / Perspective View...")

# Canvas dimensions
W, H = 2400, 1400
canvas = np.zeros((H, W, 4), dtype=np.uint8)

# Dark slate background gradient
for y in range(H):
    r = int(13 + (30 - 13) * (y / H))
    g = int(31 + (41 - 31) * (y / H))
    b = int(45 + (59 - 45) * (y / H))
    canvas[y, :, :] = [r, g, b, 255]

# Load rendered maps
img_top = cv2.imread(top_img_path, cv2.IMREAD_UNCHANGED)
img_bot = cv2.imread(bot_img_path, cv2.IMREAD_UNCHANGED)

h_src, w_src = img_top.shape[:2]
src_pts = np.float32([[0, 0], [w_src, 0], [w_src, h_src], [0, h_src]])

# Perspective coordinates for Top Layer (Surface Map)
# Trapezius / Isometric plane
top_dst_pts = np.float32([
    [260,  150],  # Top-Left
    [2140, 150],  # Top-Right
    [2300, 520],  # Bottom-Right
    [100,  520]   # Bottom-Left
])

# Perspective coordinates for Bottom Layer (OMZ Map)
bot_dst_pts = np.float32([
    [260,  620],  # Top-Left
    [2140, 620],  # Top-Right
    [2300, 1020], # Bottom-Right
    [100,  1020]  # Bottom-Left
])

# Apply Perspective Warp
M_top = cv2.getPerspectiveTransform(src_pts, top_dst_pts)
warped_top = cv2.warpPerspective(img_top, M_top, (W, H))

M_bot = cv2.getPerspectiveTransform(src_pts, bot_dst_pts)
warped_bot = cv2.warpPerspective(img_bot, M_bot, (W, H))

# Overlay helper
def overlay_img(bg, fg):
    alpha = fg[:, :, 3] / 255.0
    for c in range(3):
        bg[:, :, c] = (1.0 - alpha) * bg[:, :, c] + alpha * fg[:, :, c]
    return bg

# Draw Bottom layer first, then Top layer
canvas = overlay_img(canvas, warped_bot)
canvas = overlay_img(canvas, warped_top)

# Convert to PIL for drawing lines, labels, colorbars
pil_img = Image.fromarray(canvas)
draw = ImageDraw.Draw(pil_img)

# Draw vertical drop lines / pillars (connecting specific coordinates)
# Key station longitudes along 25°S
stations_lon = [40, 60, 75, 90, 105]
stations_lat = -25

# Coordinate mapping from (lon, lat) to warped pixel coords
def map_coords(lon, lat, M_transform):
    # Normalized coords in PlateCarree (lon: [-180, 180] -> [0, w_src], lat: [90, -90] -> [0, h_src])
    x_norm = (lon + 180.0) / 360.0 * w_src
    y_norm = (90.0 - lat) / 180.0 * h_src
    pt = np.array([[[x_norm, y_norm]]], dtype=np.float32)
    pt_warped = cv2.perspectiveTransform(pt, M_transform)
    return float(pt_warped[0, 0, 0]), float(pt_warped[0, 0, 1])

for st_lon in stations_lon:
    x_t, y_t = map_coords(st_lon, stations_lat, M_top)
    x_b, y_b = map_coords(st_lon, stations_lat, M_bot)
    
    # Draw dashed vertical pillar line
    draw.line([(x_t, y_t), (x_b, y_b)], fill=(255, 255, 255, 180), width=2)
    # Station dots
    draw.ellipse([x_t-4, y_t-4, x_t+4, y_t+4], fill=(225, 29, 72, 255), outline=(255, 255, 255, 255))
    draw.ellipse([x_b-4, y_b-4, x_b+4, y_b+4], fill=(255, 255, 255, 220))

# Side depth axis labels
draw.text((30, 510), "0m\nSurface", fill=(224, 231, 255), font_size=20)
draw.text((30, 800), "~500m\nOMZ Core\nDepth", fill=(224, 231, 255), font_size=20)
draw.text((30, 1010), "~2000m", fill=(224, 231, 255), font_size=20)

# Save high-res composite image
final_path = "final_3d_ocean_sandwich.png"
pil_img.save(final_path)
print(f"5. Successfully generated 3D Perspective Ocean Sandwich map at: {final_path}")

# Also render Matplotlib figure with colorbars on top & bottom to make it publication-perfect
fig_final = plt.figure(figsize=(16, 11), dpi=300, facecolor='#0d1f2d')
ax_bg = fig_final.add_axes([0, 0, 1, 1])
ax_bg.imshow(np.array(pil_img))
ax_bg.axis('off')

# Top Colorbar (Chlorophyll-a)
ax_cbar1 = fig_final.add_axes([0.25, 0.92, 0.50, 0.025])
cbar1 = fig_final.colorbar(mesh1, cax=ax_cbar1, orientation='horizontal', extend='both')
cbar1.set_label('Surface Chlorophyll-$a$ ($\mathrm{mg\ m^{-3}}$, Annual Climatology)', color='white', fontsize=12, labelpad=8)
cbar1.ax.tick_params(colors='white', labelsize=10)

# Bottom Colorbar (Dissolved Oxygen Minimum)
ax_cbar2 = fig_final.add_axes([0.25, 0.05, 0.50, 0.025])
cbar2 = fig_final.colorbar(mesh2, cax=ax_cbar2, orientation='horizontal', extend='both')
cbar2.set_label('Dissolved Oxygen Minimum ($\mathrm{\mu mol\ kg^{-1}}$, WOA18 Climatology)', color='white', fontsize=12, labelpad=8)
cbar2.ax.tick_params(colors='white', labelsize=10)

pub_final_path = "ocean_3d_sandwich_publication.png"
plt.savefig(pub_final_path, dpi=300, bbox_inches='tight', facecolor='#0d1f2d')
plt.close()

print(f"6. Publication-grade final figure generated at: {pub_final_path}")
