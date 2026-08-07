import os
import numpy as np
import xarray as xr
import matplotlib.pyplot as plt
import matplotlib.colors as mcolors
import matplotlib.ticker as mticker
import cartopy.crs as ccrs
import cartopy.feature as cfeature
from PIL import Image

# Set UTF-8 encoding
import sys
sys.stdout.reconfigure(encoding='utf-8')

print("Loading WOA18 Dissolved Oxygen Minimum Data...")
ds_omz = xr.open_dataset('data/woa18_omz_min_extracted.nc', decode_times=False)
lats_omz = ds_omz['lat'].values
lons_omz = ds_omz['lon'].values
o2_data = ds_omz['omz_min'].values # shape (180, 360)

lon_grid, lat_grid = np.meshgrid(lons_omz, lats_omz)

# Load target user image to get exact resolution/aspect ratio
user_img_path = r'C:\Users\Windows\.gemini\antigravity-ide\brain\a79f783e-9686-45f4-a2f0-5aacae89af16\media__1785803299908.png'
user_img = Image.open(user_img_path)
target_w, target_h = user_img.size
print(f"User Chlorophyll Map resolution: {target_w}x{target_h}")

# Render Bottom OMZ Map matching exact Cartopy template
fig = plt.figure(figsize=(target_w / 100.0, target_h / 100.0), dpi=300)
ax = fig.add_subplot(1, 1, 1, projection=ccrs.PlateCarree())

# Match lat range [-70, 75] and lon range [-180, 180]
ax.set_extent([-180, 180, -70, 75], crs=ccrs.PlateCarree())

# Colormap for Oxygen Minimum: Reversed Viridis or Spectral_r
# Oxygen Minimum: 0-20 (OMZ Core / Hypoxia) -> Dark Red/Brown, ~60 -> Gold/Yellow, >150 -> Blue-Green
cmap_o2 = plt.colormaps['viridis_r'] # Reversed Viridis

mesh = ax.pcolormesh(
    lon_grid, lat_grid, o2_data,
    cmap=cmap_o2,
    vmin=0, vmax=250,
    transform=ccrs.PlateCarree(),
    zorder=1
)

# Matching Land Feature & White Coastline Border
# Land color: #E5ECF6 (light blue-grey), coastline: white outline
ax.add_feature(cfeature.LAND, facecolor='#E5ECF6', edgecolor='white', linewidth=0.8, zorder=2)
ax.add_feature(cfeature.COASTLINE, linewidth=0.8, edgecolor='white', zorder=3)

# Matching Dotted Gridlines & Labels
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

gl.xlabel_style = {'size': 7, 'color': '#475569'}
gl.ylabel_style = {'size': 7, 'color': '#475569'}

# Colorbar matching exact format of Chlorophyll map
cbar = fig.colorbar(
    mesh, ax=ax,
    orientation='horizontal',
    pad=0.08, shrink=0.55,
    extend='both'
)
cbar.set_label('Dissolved Oxygen Minimum ($\mu\mathrm{mol\ kg^{-1}}$, WOA18 Climatology)', fontsize=9, labelpad=4)
cbar.ax.tick_params(labelsize=8)

output_omz_path = 'user_template_bottom_omz.png'
plt.savefig(output_omz_path, dpi=300, bbox_inches='tight', facecolor='white')
plt.close()

print(f"Successfully generated matching Bottom OMZ Map at: {output_omz_path}")
