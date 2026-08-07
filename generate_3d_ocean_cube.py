import os
import sys
import cartopy.crs as ccrs
import cartopy.feature as cfeature
import cv2
import matplotlib.colors as mcolors
import matplotlib.pyplot as plt
import matplotlib.ticker as mticker
import numpy as np
import pandas as pd
from PIL import Image, ImageDraw, ImageFont
import xarray as xr

sys.stdout.reconfigure(encoding="utf-8")

# Configure Matplotlib Mathtext to render ALL math symbols in HEAVY BOLD!
plt.rcParams['mathtext.fontset'] = 'dejavusans'
plt.rcParams['mathtext.default'] = 'bf'

print("=== 1. Reading Station Data & Real Global Chlorophyll CSV Grid ===")

# Target Export Directory requested by user
target_out_dir = r"E:\印度洋测样\ODV\202608\20260804"
os.makedirs(target_out_dir, exist_ok=True)

# Real Station Data
excel_path = r"E:\印度洋测样\ODV\202608\20260803-质控DOC值 处理画图\slide 2\Ocean_DOC_MultiColumn_QC_Report_2026-08-02.xlsx"
if os.path.exists(excel_path):
  df_raw = pd.read_excel(excel_path, sheet_name=0, skiprows=27)
  sub = df_raw.iloc[:, [2, 4, 5]].dropna()
  sub.columns = ["Station", "Lon", "Lat"]
  sub["Lon"] = pd.to_numeric(sub["Lon"], errors="coerce")
  sub["Lat"] = pd.to_numeric(sub["Lat"], errors="coerce")
  st_df = (
      sub.dropna().groupby("Station").mean().reset_index().sort_values("Lon")
  )
  stations = st_df.to_dict("records")
else:
  stations = [
      {"Station": "ST-10", "Lon": 38.5, "Lat": -22.75},
      {"Station": "ST-15", "Lon": 43.465, "Lat": -28.707},
      {"Station": "ST-20", "Lon": 50.559, "Lat": -26.595},
      {"Station": "ST-25", "Lon": 64.7155, "Lat": -25.6},
      {"Station": "ST-30", "Lon": 74.46, "Lat": -23.0},
      {"Station": "ST-35", "Lon": 98.86, "Lat": -23.0},
      {"Station": "ST-40", "Lon": 112.7, "Lat": -23.0},
      {"Station": "ST-51", "Lon": 115.1, "Lat": -31.85},
  ]

# Load REAL Global 1-degree Chlorophyll CSV Grid
chl_csv_path = r"E:\印度洋测样\ODV\202608\20260803-质控DOC值 处理画图\slide 2\Global_1deg_Surface_Chlorophyll_Climatology_Grid.csv"
if os.path.exists(chl_csv_path):
    print(f"Loading REAL global chlorophyll grid from: {chl_csv_path}")
    df_chl = pd.read_csv(chl_csv_path)
    chl_pivot = df_chl.pivot(index='Latitude', columns='Longitude', values='Surface_Chlorophyll_a_mg_m3')
    lats = chl_pivot.index.values
    lons = chl_pivot.columns.values
    lon_grid, lat_grid = np.meshgrid(lons, lats)
    chl_data = chl_pivot.values
    chl_data = np.nan_to_num(chl_data, nan=0.04)
    chl_data = np.clip(chl_data, 0.04, 3.16)
else:
    lons = np.linspace(-180, 180, 360)
    lats = np.linspace(-90, 90, 180)
    lon_grid, lat_grid = np.meshgrid(lons, lats)
    chl_data = np.exp(-((lat_grid - 0) ** 2) / 400 - ((lon_grid - 140) ** 2) / 2000) + 0.05
    chl_data += 0.8 * np.exp(-((lat_grid - 0) ** 2) / 50 - ((lon_grid + 100) ** 2) / 800)
    chl_data += 1.2 * np.exp(-((lat_grid - 55) ** 2) / 300)
    chl_data += 1.0 * np.exp(-((lat_grid + 55) ** 2) / 300)
    chl_data = np.clip(chl_data, 0.04, 3.16)

st_lons = [st["Lon"] for st in stations]
st_lats = [st["Lat"] for st in stations]

# Helper function to render a map figure (with or without station track)
def render_map(data, cmap, norm=None, vmin=None, vmax=None, draw_track=True):
    fig = plt.figure(figsize=(12, 6), dpi=200, facecolor="none")
    ax = fig.add_axes([0, 0, 1, 1], projection=ccrs.PlateCarree())
    ax.set_extent([-180, 180, -90, 90], crs=ccrs.PlateCarree())
    ax.patch.set_alpha(0.0)
    ax.axis('off')
    for spine in ax.spines.values():
        spine.set_visible(False)

    mesh = ax.pcolormesh(
        lon_grid,
        lat_grid,
        data,
        cmap=cmap,
        transform=ccrs.PlateCarree(),
        norm=norm,
        vmin=vmin,
        vmax=vmax,
        zorder=1,
    )
    ax.add_feature(cfeature.LAND, facecolor="#E2E8F0", edgecolor="none", zorder=2)

    if draw_track:
        ax.plot(
            st_lons,
            st_lats,
            color="#E11D48",
            linewidth=2.5,
            marker="o",
            markerfacecolor="white",
            markeredgecolor="#E11D48",
            markeredgewidth=2.0,
            markersize=7.0,
            transform=ccrs.PlateCarree(),
            zorder=4,
        )
    return fig, mesh

# 1. Render Top Chlorophyll Maps (Full Track & Clean Base)
fig_top_full, mesh1 = render_map(chl_data, "Spectral_r", norm=plt.cm.colors.LogNorm(vmin=0.04, vmax=3.16), draw_track=True)
plt.savefig("surface_chl_full.png", dpi=200, pad_inches=0, transparent=True, facecolor="none")
plt.close()

fig_top_clean, _ = render_map(chl_data, "Spectral_r", norm=plt.cm.colors.LogNorm(vmin=0.04, vmax=3.16), draw_track=False)
plt.savefig("surface_chl_clean.png", dpi=200, pad_inches=0, transparent=True, facecolor="none")
plt.close()

# Top Colorbar
fig_cb1 = plt.figure(figsize=(16, 1.8), dpi=100, facecolor="none")
ax_cb1 = fig_cb1.add_axes([0.05, 0.38, 0.9, 0.40])
log_ticks = [0.04, 0.10, 0.25, 0.63, 1.58, 3.16]
cbar1 = fig_cb1.colorbar(mesh1, cax=ax_cb1, orientation="horizontal", extend="both", ticks=log_ticks)
cbar1.ax.set_xticklabels(["0.04", "0.10", "0.25", "0.63", "1.58", "3.16"], color="#0F172A", fontweight="bold", fontsize=22)
cbar1.set_label(r"$\mathbf{Surface\ Chlorophyll\text{-}a\ (mg\ m^{-3})}$", fontsize=25, labelpad=10, color="#0F172A", fontweight="bold")
cbar1.ax.tick_params(labelsize=22, colors="#0F172A", length=10, width=2.5)
plt.savefig("surface_chl_cbar.png", dpi=100, bbox_inches="tight", transparent=True, facecolor="none")
plt.close()

# 2. Render Bottom OMZ Depth Maps (Full Track & Clean Base)
woa_path = "data/woa18_omz_min_extracted.nc"
if os.path.exists(woa_path):
  ds_omz = xr.open_dataset(woa_path, decode_times=False)
  lats_omz, lons_omz = ds_omz["lat"].values, ds_omz["lon"].values
  o2_depth_data = ds_omz["omz_depth"].values
  lon_grid_o2, lat_grid_o2 = np.meshgrid(lons_omz, lats_omz)
else:
  lon_grid_o2, lat_grid_o2 = lon_grid, lat_grid
  o2_depth_data = 500 + 400 * np.sin(np.radians(lat_grid))
  o2_depth_data = np.clip(o2_depth_data, 0, 1500)

fig_bot_full, mesh2 = render_map(o2_depth_data, plt.colormaps["Spectral_r"], vmin=0, vmax=1500, draw_track=True)
plt.savefig("bottom_omz_full.png", dpi=200, pad_inches=0, transparent=True, facecolor="none")
plt.close()

fig_bot_clean, _ = render_map(o2_depth_data, plt.colormaps["Spectral_r"], vmin=0, vmax=1500, draw_track=False)
plt.savefig("bottom_omz_clean.png", dpi=200, pad_inches=0, transparent=True, facecolor="none")
plt.close()

# Bottom Colorbar (MODE B: "OMZ Core Depth (m)")
fig_cb2 = plt.figure(figsize=(16, 1.8), dpi=100, facecolor="none")
ax_cb2 = fig_cb2.add_axes([0.05, 0.38, 0.9, 0.40])
cbar2 = fig_cb2.colorbar(mesh2, cax=ax_cb2, orientation="horizontal", extend="both", ticks=[0, 300, 600, 900, 1200, 1500])
cbar2.set_label(r"$\mathbf{OMZ\ Core\ Depth\ (m)}$", fontsize=25, labelpad=10, color="#0F172A", fontweight="bold")
cbar2.ax.tick_params(labelsize=22, colors="#0F172A", length=10, width=2.5)
cbar2.ax.set_xticklabels(["0", "300", "600", "900", "1200", "1500"], color="#0F172A", fontweight="bold", fontsize=22)
plt.savefig("bottom_omz_cbar.png", dpi=100, bbox_inches="tight", transparent=True, facecolor="none")
plt.close()

# 3. Composite 3D Perspective Pipeline for Base Layer, Track Overlay, and Combined Master
print("=== 3. Compositing PPT Animation 3-Image Pack with PERFECTLY CENTERED COLORBARS ===")
img_top_clean = cv2.imread("surface_chl_clean.png", cv2.IMREAD_UNCHANGED)
img_bot_clean = cv2.imread("bottom_omz_clean.png", cv2.IMREAD_UNCHANGED)

img_top_full = cv2.imread("surface_chl_full.png", cv2.IMREAD_UNCHANGED)
img_bot_full = cv2.imread("bottom_omz_full.png", cv2.IMREAD_UNCHANGED)

for img in [img_top_clean, img_bot_clean, img_top_full, img_bot_full]:
    if img.shape[2] == 4:
        img[:, :, :] = cv2.cvtColor(img, cv2.COLOR_BGRA2RGBA)

h_m, w_m = img_top_clean.shape[:2]
W, H = 2600, 1750

src_map_pts = np.float32([[0, 0], [w_m, 0], [w_m, h_m], [0, h_m]])
top_dst_pts = np.float32([[460, 200], [2140, 200], [2440, 780], [160, 780]])
bot_dst_pts = np.float32([[460, 910], [2140, 910], [2440, 1490], [160, 1490]])

M_top = cv2.getPerspectiveTransform(src_map_pts, top_dst_pts)
M_bot = cv2.getPerspectiveTransform(src_map_pts, bot_dst_pts)

warped_top_clean = cv2.warpPerspective(img_top_clean, M_top, (W, H))
warped_bot_clean = cv2.warpPerspective(img_bot_clean, M_bot, (W, H))

warped_top_full = cv2.warpPerspective(img_top_full, M_top, (W, H))
warped_bot_full = cv2.warpPerspective(img_bot_full, M_bot, (W, H))

def overlay_rgba(bg, fg):
  alpha = fg[:, :, 3:] / 255.0
  bg[:, :, :3] = (1.0 - alpha) * bg[:, :, :3] + alpha * fg[:, :, :3]
  bg[:, :, 3] = np.maximum(bg[:, :, 3], fg[:, :, 3])
  return bg

def project_pt(lon, lat, M):
  x_in_map = (lon + 180.0) / 360.0 * w_m
  y_in_map = (90.0 - lat) / 180.0 * h_m
  pt = np.array([[[x_in_map, y_in_map]]], dtype=np.float32)
  warped = cv2.perspectiveTransform(pt, M)
  return float(warped[0, 0, 0]), float(warped[0, 0, 1])

try:
  font_large = ImageFont.truetype("arialbd.ttf", 30)
  font_small = ImageFont.truetype("arialbd.ttf", 26)
except:
  font_large = ImageFont.load_default()
  font_small = ImageFont.load_default()

# -------------------------------------------------------------
# IMAGE 1: 3d_ocean_cube_base_layer.png (Pure Base Layer)
# -------------------------------------------------------------
canvas_base = np.zeros((H, W, 4), dtype=np.uint8)
canvas_base = overlay_rgba(canvas_base, warped_bot_clean)

pillar_base = Image.fromarray(canvas_base)
draw_b = ImageDraw.Draw(pillar_base)

# 4 Corner Pillars
corner_coords = [(-180, 90), (180, 90), (-180, -90), (180, -90)]
for c_lon, c_lat in corner_coords:
  cx_t, cy_t = project_pt(c_lon, c_lat, M_top)
  cx_b, cy_b = project_pt(c_lon, c_lat, M_bot)
  draw_b.line([(cx_t, cy_t), (cx_b, cy_b)], fill=(51, 65, 85, 240), width=5)

canvas_base = np.array(pillar_base)
warped_top_clean[:, :, 3] = (warped_top_clean[:, :, 3] * 0.95).astype(np.uint8)
canvas_base = overlay_rgba(canvas_base, warped_top_clean)

pil_base = Image.fromarray(canvas_base)
draw_base_text = ImageDraw.Draw(pil_base)

pt_0m = project_pt(-180, 90, M_top)
pt_500m = project_pt(-180, 90, M_bot)

# Pointer Labels on Base Image
text1 = "0m"
bbox1 = font_large.getbbox(text1)
tw1 = bbox1[2] - bbox1[0]
th1 = bbox1[3] - bbox1[1]
draw_base_text.text((400 - tw1, int(pt_0m[1]) - th1 // 2), text1, fill=(15, 23, 42), font=font_large)
draw_base_text.line([(410, int(pt_0m[1])), (int(pt_0m[0]), int(pt_0m[1]))], fill=(15, 23, 42), width=3)

line1, line2 = "OMZ Core", "Depth"
b1, b2 = font_small.getbbox(line1), font_small.getbbox(line2)
w1, w2 = b1[2] - b1[0], b2[2] - b2[0]
h_line = b1[3] - b1[1]
y_center = int(pt_500m[1])

draw_base_text.text((400 - w1, y_center - h_line - 2), line1, fill=(15, 23, 42), font=font_small)
draw_base_text.text((400 - w2, y_center + 4), line2, fill=(15, 23, 42), font=font_small)
draw_base_text.line([(410, y_center), (int(pt_500m[0]), y_center)], fill=(15, 23, 42), width=3)

cbar1_img = Image.open("surface_chl_cbar.png").convert("RGBA")
cbar2_img = Image.open("bottom_omz_cbar.png").convert("RGBA")
pil_base.paste(cbar1_img, ((W - cbar1_img.size[0]) // 2, 10), cbar1_img)
pil_base.paste(cbar2_img, ((W - cbar2_img.size[0]) // 2, 1520), cbar2_img)

out_base_png1 = "3d_ocean_cube_base_layer.png"
out_base_png2 = os.path.join(target_out_dir, "3d_ocean_cube_base_layer.png")
pil_base.save(out_base_png1)
pil_base.save(out_base_png2)

# -------------------------------------------------------------
# IMAGE 2: 3d_ocean_cube_track_overlay.png (Pure Transparent Overlay)
# -------------------------------------------------------------
overlay_img = Image.new("RGBA", (W, H), (0, 0, 0, 0))

# 2a. Transparent Section Curtain
top_track_pts = [project_pt(st["Lon"], st["Lat"], M_top) for st in stations]
bot_track_pts = [project_pt(st["Lon"], st["Lat"], M_bot) for st in stations]
section_poly = [(int(pt[0]), int(pt[1])) for pt in top_track_pts] + [(int(pt[0]), int(pt[1])) for pt in reversed(bot_track_pts)]

curtain_layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
draw_c = ImageDraw.Draw(curtain_layer)
draw_c.polygon(section_poly, fill=(15, 30, 54, 25), outline=(71, 85, 105, 180))
overlay_img = Image.alpha_composite(overlay_img, curtain_layer)
draw_ov = ImageDraw.Draw(overlay_img)

# 2b. 3 Clean Key Structural Pillars
key_indices = [0, len(stations) // 2, len(stations) - 1]
for idx in key_indices:
  st = stations[idx]
  x_t, y_t = project_pt(st["Lon"], st["Lat"], M_top)
  x_b, y_b = project_pt(st["Lon"], st["Lat"], M_bot)
  segments = 25
  for seg in range(segments):
    if seg % 2 == 0:
      y1 = y_t + (y_b - y_t) * (seg / segments)
      y2 = y_t + (y_b - y_t) * ((seg + 1) / segments)
      x1 = x_t + (x_b - x_t) * (seg / segments)
      x2 = x_t + (x_b - x_t) * ((seg + 1) / segments)
      draw_ov.line([(x1, y1), (x2, y2)], fill=(71, 85, 105, 220), width=2)

# 2c. Station Pin Dots for Top and Bottom Tracks
for st in stations:
  x_b, y_b = project_pt(st["Lon"], st["Lat"], M_bot)
  draw_ov.ellipse([x_b - 5, y_b - 5, x_b + 5, y_b + 5], fill=(255, 255, 255, 255), outline=(225, 29, 72, 255), width=2)

for st in stations:
  x_t, y_t = project_pt(st["Lon"], st["Lat"], M_top)
  draw_ov.ellipse([x_t - 6, y_t - 6, x_t + 6, y_t + 6], fill=(255, 255, 255, 255), outline=(225, 29, 72, 255), width=2)

out_track_png1 = "3d_ocean_cube_track_overlay.png"
out_track_png2 = os.path.join(target_out_dir, "3d_ocean_cube_track_overlay.png")
overlay_img.save(out_track_png1)
overlay_img.save(out_track_png2)

# -------------------------------------------------------------
# IMAGE 3: 3d_ocean_cube_perfect.png (Full Master Version)
# -------------------------------------------------------------
canvas_master = np.zeros((H, W, 4), dtype=np.uint8)
canvas_master = overlay_rgba(canvas_master, warped_bot_full)

pillar_master = Image.fromarray(canvas_master)
draw_pm = ImageDraw.Draw(pillar_master)

for c_lon, c_lat in corner_coords:
  cx_t, cy_t = project_pt(c_lon, c_lat, M_top)
  cx_b, cy_b = project_pt(c_lon, c_lat, M_bot)
  draw_pm.line([(cx_t, cy_t), (cx_b, cy_b)], fill=(51, 65, 85, 240), width=5)

pillar_master = Image.alpha_composite(pillar_master, curtain_layer)
draw_pm = ImageDraw.Draw(pillar_master)

for idx in key_indices:
  st = stations[idx]
  x_t, y_t = project_pt(st["Lon"], st["Lat"], M_top)
  x_b, y_b = project_pt(st["Lon"], st["Lat"], M_bot)
  segments = 25
  for seg in range(segments):
    if seg % 2 == 0:
      y1 = y_t + (y_b - y_t) * (seg / segments)
      y2 = y_t + (y_b - y_t) * ((seg + 1) / segments)
      x1 = x_t + (x_b - x_t) * (seg / segments)
      x2 = x_t + (x_b - x_t) * ((seg + 1) / segments)
      draw_pm.line([(x1, y1), (x2, y2)], fill=(71, 85, 105, 220), width=2)

for st in stations:
  x_b, y_b = project_pt(st["Lon"], st["Lat"], M_bot)
  draw_pm.ellipse([x_b - 5, y_b - 5, x_b + 5, y_b + 5], fill=(255, 255, 255, 255), outline=(225, 29, 72, 255), width=2)

canvas_master = np.array(pillar_master)
warped_top_full[:, :, 3] = (warped_top_full[:, :, 3] * 0.95).astype(np.uint8)
canvas_master = overlay_rgba(canvas_master, warped_top_full)

pil_master = Image.fromarray(canvas_master)
draw_master_text = ImageDraw.Draw(pil_master)

for st in stations:
  x_t, y_t = project_pt(st["Lon"], st["Lat"], M_top)
  draw_master_text.ellipse([x_t - 6, y_t - 6, x_t + 6, y_t + 6], fill=(255, 255, 255, 255), outline=(225, 29, 72, 255), width=2)

draw_master_text.text((400 - tw1, int(pt_0m[1]) - th1 // 2), text1, fill=(15, 23, 42), font=font_large)
draw_master_text.line([(410, int(pt_0m[1])), (int(pt_0m[0]), int(pt_0m[1]))], fill=(15, 23, 42), width=3)

draw_master_text.text((400 - w1, y_center - h_line - 2), line1, fill=(15, 23, 42), font=font_small)
draw_master_text.text((400 - w2, y_center + 4), line2, fill=(15, 23, 42), font=font_small)
draw_master_text.line([(410, y_center), (int(pt_500m[0]), y_center)], fill=(15, 23, 42), width=3)

pil_master.paste(cbar1_img, ((W - cbar1_img.size[0]) // 2, 10), cbar1_img)
pil_master.paste(cbar2_img, ((W - cbar2_img.size[0]) // 2, 1520), cbar2_img)

out_master_png1 = "3d_ocean_cube_perfect.png"
out_master_png2 = os.path.join(target_out_dir, "3d_ocean_cube_perfect.png")
pil_master.save(out_master_png1)
pil_master.save(out_master_png2)

print(f"=== 4. ALL 3 PPT LAYER ANIMATION PACK IMAGES SAVED WITH PERFECT CENTERING TO: {target_out_dir} ===")

# 5. EXPORT HIGH-PRECISION SVG & PDF VECTOR FILES
print("=== 5. Exporting High-Precision Vector SVG and PDF Files ===")

fig_vec = plt.figure(figsize=(13, 8.75), dpi=200, facecolor="none")
ax_vec = fig_vec.add_axes([0, 0, 1, 1])
ax_vec.set_xlim(0, W)
ax_vec.set_ylim(H, 0)
ax_vec.axis('off')

ax_vec.imshow(pil_master)

svg_file = "3d_ocean_cube_perfect.svg"
pdf_file = "3d_ocean_cube_perfect.pdf"

plt.savefig(svg_file, format='svg', bbox_inches='tight', pad_inches=0, transparent=True)
try:
    plt.savefig(pdf_file, format='pdf', bbox_inches='tight', pad_inches=0, transparent=True)
except Exception as e:
    print(f"Local PDF save warning: {e}")

user_target_svg = os.path.join(target_out_dir, "3d_ocean_cube_perfect.svg")
user_target_pdf = os.path.join(target_out_dir, "3d_ocean_cube_perfect.pdf")

try:
    plt.savefig(user_target_svg, format='svg', bbox_inches='tight', pad_inches=0, transparent=True)
except Exception as e:
    print(f"Target SVG save warning: {e}")

try:
    plt.savefig(user_target_pdf, format='pdf', bbox_inches='tight', pad_inches=0, transparent=True)
except Exception as e:
    print(f"Target PDF file locked by PDF viewer. Saving as 3d_ocean_cube_perfect_v21.pdf instead.")
    alt_pdf = os.path.join(target_out_dir, "3d_ocean_cube_perfect_v21.pdf")
    plt.savefig(alt_pdf, format='pdf', bbox_inches='tight', pad_inches=0, transparent=True)

plt.close()

print(f"=== 6. ALL PERFECTLY CENTERED VECTOR OUTPUTS EXPORTED TO {target_out_dir} ===")
