import os
import numpy as np
import xarray as xr
import matplotlib.pyplot as plt
import matplotlib.colors as mcolors
import plotly.graph_objects as go

# 1. Load Data
print("Loading extracted WOA18 OMZ and MODIS Chlorophyll data...")
ds_omz = xr.open_dataset('data/woa18_omz_min_extracted.nc', decode_times=False)
ds_chl = xr.open_dataset('data/surface_chlorophyll_1deg.nc', decode_times=False)

lats = ds_omz['lat'].values
lons = ds_omz['lon'].values
omz_min = ds_omz['omz_min'].values # shape (180, 360)

chl_raw = ds_chl['chlorophyll'].values.squeeze() # shape (180, 359)
# Pad longitude to match 360
chl = np.zeros((180, 360))
chl[:, :359] = chl_raw
chl[:, 359] = chl_raw[:, -1]

# Log-transform chlorophyll for vibrant rendering
chl_log = np.log10(np.clip(chl, 0.01, 20.0))

# 2. Downsample for ultra-smooth 3D web rendering (2-degree grid)
step = 2
lats_sub = lats[::step]
lons_sub = lons[::step]
omz_sub = omz_min[::step, ::step]
chl_log_sub = chl_log[::step, ::step]

lon_grid, lat_grid = np.meshgrid(lons_sub, lats_sub)

# Define Z layers (Surface at Z=0, OMZ at Z=-80)
z_top = np.zeros_like(lat_grid)
z_bottom = np.full_like(lat_grid, -80.0)

# Create 3D Figure with Plotly
print("Building interactive 3D Ocean Data Cube with Plotly...")
fig = go.Figure()

# --- Top Layer: Surface Chlorophyll-a (Inferno Color Scale) ---
fig.add_trace(go.Surface(
    x=lon_grid,
    y=lat_grid,
    z=z_top,
    surfacecolor=chl_log_sub,
    colorscale='Inferno',
    cmin=np.nanmin(chl_log_sub),
    cmax=np.nanmax(chl_log_sub),
    opacity=0.88,
    name='Surface Chlorophyll-a (Inferno)',
    colorbar=dict(
        title='log10(Chl-a mg/m³)',
        len=0.4,
        y=0.75,
        x=1.02
    ),
    hovertemplate='Lon: %{x}°<br>Lat: %{y}°<br>log10(Chl-a): %{surfacecolor:.2f}<extra>Top: Surface Chl-a</extra>'
))

# --- Bottom Layer: OMZ Minimum Dissolved Oxygen (Reversed Viridis Color Scale) ---
# High O2 -> Blue/Teal; Low O2 (OMZ Hypoxia) -> Dark Red/Brown
fig.add_trace(go.Surface(
    x=lon_grid,
    y=lat_grid,
    z=z_bottom,
    surfacecolor=omz_sub,
    colorscale='Viridis_r', # Reversed Viridis
    cmin=0,
    cmax=250, # Typical oxygen range
    opacity=0.88,
    name='OMZ Minimum O2 (Reversed Viridis)',
    colorbar=dict(
        title='Min Dissolved O₂ (μmol/kg)',
        len=0.4,
        y=0.25,
        x=1.02
    ),
    hovertemplate='Lon: %{x}°<br>Lat: %{y}°<br>Min O₂: %{surfacecolor:.1f} μmol/kg<extra>Bottom: OMZ Minimum</extra>'
))

# --- 3D Vertical Pillars along 25°S Transect Line ---
print("Adding vertical transect pillars along 25°S...")
transect_lat = -25.0
transect_lons = np.linspace(35.0, 115.0, 15) # From S. Africa to W. Australia

for i, t_lon in enumerate(transect_lons):
    fig.add_trace(go.Scatter3d(
        x=[t_lon, t_lon],
        y=[transect_lat, transect_lat],
        z=[0, -80],
        mode='lines+markers',
        line=dict(color='#ff2255', width=4, dash='dash'),
        marker=dict(size=4, color='#ffffff'),
        name=f'Pillar {i+1}' if i==0 else None,
        showlegend=(i==0),
        hoverinfo='none'
    ))

# Camera & Layout Configuration
fig.update_layout(
    title=dict(
        text='<b>3D Ocean Data Cube: Surface Chlorophyll vs. Deep OMZ (WOA18)</b>',
        x=0.5,
        font=dict(size=20)
    ),
    scene=dict(
        xaxis=dict(title='Longitude (°E)', range=[-180, 180], backgroundcolor='#0f172a', gridcolor='#334155'),
        yaxis=dict(title='Latitude (°N)', range=[-90, 90], backgroundcolor='#0f172a', gridcolor='#334155'),
        zaxis=dict(title='Depth Level', range=[-100, 20], backgroundcolor='#0f172a', gridcolor='#334155', showticklabels=False),
        camera=dict(
            eye=dict(x=1.4, y=-1.5, z=1.2) # Isometric 3D angle
        ),
        aspectratio=dict(x=2, y=1, z=0.8)
    ),
    paper_bgcolor='#090d16',
    font=dict(color='#f8fafc'),
    margin=dict(l=0, r=0, b=0, t=50)
)

# Export interactive HTML
html_path = 'ocean_3d_cube.html'
fig.write_html(html_path)
print(f"Successfully generated interactive 3D Ocean Data Cube at: {html_path}")

# 3. Create static Matplotlib 3D figure for export
print("Generating static 3D Matplotlib plot...")
fig_mpl = plt.figure(figsize=(14, 10), facecolor='#090d16')
ax = fig_mpl.add_subplot(111, projection='3d', facecolor='#090d16')

# Plot top surface
surf_top = ax.plot_surface(lon_grid, lat_grid, z_top, facecolors=plt.cm.inferno((chl_log_sub - np.nanmin(chl_log_sub))/(np.nanmax(chl_log_sub) - np.nanmin(chl_log_sub))), rstride=1, cstride=1, alpha=0.85, antialiased=True)

# Plot bottom surface (Reversed Viridis)
viridis_r = plt.colormaps['viridis_r']
norm_omz = mcolors.Normalize(vmin=0, vmax=250)
surf_bot = ax.plot_surface(lon_grid, lat_grid, z_bottom, facecolors=viridis_r(norm_omz(omz_sub)), rstride=1, cstride=1, alpha=0.85, antialiased=True)

# Add transect pillars
for t_lon in transect_lons:
    ax.plot([t_lon, t_lon], [transect_lat, transect_lat], [0, -80], color='#ff3366', linestyle='--', linewidth=1.5, marker='o', markersize=3, markerfacecolor='white')

ax.set_xlabel('Longitude (°)', color='white', labelpad=10)
ax.set_ylabel('Latitude (°)', color='white', labelpad=10)
ax.set_zlabel('Vertical Layer', color='white', labelpad=10)
ax.tick_params(colors='white')
ax.view_init(elev=28, azim=-60)
ax.set_title('3D Ocean Data Cube: Surface Productivity & Deep OMZ', color='white', fontsize=14, pad=20)

png_path = 'ocean_3d_cube.png'
plt.savefig(png_path, dpi=200, bbox_inches='tight', facecolor='#090d16')
print(f"Successfully generated static 3D PNG at: {png_path}")
