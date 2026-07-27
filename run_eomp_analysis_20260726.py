import os
import sys
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
from scipy.optimize import nnls

# Set stdout/stderr encoding to utf-8 for Windows console support
sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')

# File paths
input_excel = r'E:\印度洋测样\ODV\20260726\Indian Ocean_SO308_DOC_Sample List(1) 的副本_odv (10)_with_density.xlsx'
output_dir = r'E:\印度洋测样\ODV\20260726'
output_excel = os.path.join(output_dir, 'eOMP_watermass_fractions_summary_20260726.xlsx')
output_png = os.path.join(output_dir, 'South_Indian_Ocean_eOMP_WaterMass_DOC_20260726.png')

print("Reading input dataset...")
df = pd.read_excel(input_excel)

# Extract relevant columns and clean missing values for eOMP variables
# Endmembers use: Temp (or Potential Temp / Cons Temp), Salinity, PO4_0, NO3_0, Silicate
temp_col = 'Conservative Temperature [deg C]' if 'Conservative Temperature [deg C]' in df.columns else 'Temperature [ITS-90]'
sal_col = 'Salinity [PSS-78]'
po4_col = 'Phosphate [µmol/L]:'
no3_col = 'Nitrate [µmol/L]:'
sio4_col = 'Silicate [µmol/L]:'
doc_col = 'DOC [µmol/L]'
aou_col = 'AOU [µmol/kg]'
nd_col = 'neutral density [kg/m^3]'
depth_col = 'Depth [m]'

# Compute Preformed Nutrients PO4^0 and NO3^0 using Redfield / Takahashi ratios:
# PO4^0 = PO4 - AOU / 163
# NO3^0 = NO3 - AOU / 10.5
df['PO4_0'] = df[po4_col] - (df[aou_col] / 163.0)
df['NO3_0'] = df[no3_col] - (df[aou_col] / 10.5)

# Endmember Definitions (5 Water Masses): STTW, SAMW, AAIW, IDW/RSW, AABW/LCDW
# Matrix order of variables: Temp, Sal, PO4_0, NO3_0, SiO4
# Weights: W_theta=150, W_S=150, W_PO40=50, W_NO30=20, W_SiO4=10, W_sum=150
water_masses = ['STTW', 'SAMW', 'AAIW', 'IDW/RSW', 'AABW/LCDW']

# Endmember parameter dictionary: [Temp, Sal, PO4_0, NO3_0, SiO4, DOC_0]
endmembers = {
    'STTW':      [18.5, 35.60, 0.20,  2.50,   1.5, 70.0],
    'SAMW':      [ 8.5, 34.65, 0.85, 11.00,   5.0, 50.0],
    'AAIW':      [ 3.8, 34.35, 1.35, 18.50,  15.0, 43.0],
    'IDW/RSW':   [ 2.5, 34.80, 1.10, 15.00,  85.0, 38.0],
    'AABW/LCDW': [ 0.9, 34.70, 1.60, 22.00, 120.0, 36.0]
}

weights = np.array([150.0, 150.0, 50.0, 20.0, 10.0, 150.0])

# Construct system matrix G (6 equations, 5 unknowns)
G_raw = np.zeros((6, 5))
for j, wm in enumerate(water_masses):
    G_raw[0:5, j] = endmembers[wm][0:5]
G_raw[5, :] = 1.0

# Apply weights to G
G_weighted = G_raw * weights[:, np.newaxis]

# Filter rows that have valid physical nutrient & physical properties
req_cols = [temp_col, sal_col, 'PO4_0', 'NO3_0', sio4_col, doc_col, aou_col, depth_col, nd_col]
valid_mask = df[req_cols].notnull().all(axis=1)
df_valid = df[valid_mask].copy().reset_index(drop=True)

print(f"Total valid samples for eOMP: {len(df_valid)}")

# Perform eOMP decomposition for each sample
f_results = []
residuals = []

for idx, row in df_valid.iterrows():
    d_raw = np.array([
        row[temp_col],
        row[sal_col],
        row['PO4_0'],
        row['NO3_0'],
        row[sio4_col],
        1.0
    ])
    d_weighted = d_raw * weights
    
    # Solve NNLS: G_weighted * f = d_weighted
    f_opt, res_norm = nnls(G_weighted, d_weighted)
    
    # Normalize fractions so sum(f) == 1
    if f_opt.sum() > 0:
        f_opt = f_opt / f_opt.sum()
    
    f_results.append(f_opt)
    residuals.append(res_norm)

f_matrix = np.array(f_results)
for j, wm in enumerate(water_masses):
    df_valid[f'f_{wm}'] = f_matrix[:, j]

df_valid['eOMP_Residual'] = residuals

# Calculate DOC_mix and DOC_degraded
doc_0_vec = np.array([endmembers[wm][5] for wm in water_masses])
df_valid['DOC_mix'] = np.dot(f_matrix, doc_0_vec)
df_valid['DOC_degraded'] = df_valid['DOC_mix'] - df_valid[doc_col]

# Save detailed results to Excel
print(f"Saving summary Excel to {output_excel}...")
df_valid.to_excel(output_excel, index=False)

# Define Neutral Density Bins
nd_bins = [0, 26.50, 26.80, 27.10, 27.40, 27.70, 27.90, 28.10, 30.00]
nd_labels = [
    '< 26.50\n(Surface/STTW)',
    '26.50-26.80\n(Upper SAMW)',
    '26.80-27.10\n(SAMW/AAIW)',
    '27.10-27.40\n(Deep AAIW)',
    '27.40-27.70\n(IDW Transition)',
    '27.70-27.90\n(1000-2000m IDW/RSW)',
    '27.90-28.10\n(Deep Water)',
    '> 28.10\n(AABW/LCDW)'
]

df_valid['ND_Bin'] = pd.cut(df_valid[nd_col], bins=nd_bins, labels=nd_labels)
bin_means = df_valid.groupby('ND_Bin', observed=False)[[f'f_{wm}' for wm in water_masses]].mean()

# Visualization
plt.style.use('seaborn-v0_8-whitegrid' if 'seaborn-v0_8-whitegrid' in plt.style.available else 'default')
fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(16, 7), dpi=300)

# Colors for water masses
colors = ['#f39c12', '#2ecc71', '#3498db', '#e74c3c', '#9b59b6']

# Subplot 1: Stacked Bar Chart by Neutral Density Bins
bottom = np.zeros(len(bin_means))
x_indices = np.arange(len(bin_means))

for j, wm in enumerate(water_masses):
    values = bin_means[f'f_{wm}'].values
    ax1.bar(x_indices, values, bottom=bottom, label=wm, color=colors[j], width=0.65, edgecolor='black', linewidth=0.5)
    bottom += values

ax1.set_xticks(x_indices)
ax1.set_xticklabels(bin_means.index, rotation=25, ha='right', fontsize=9)
ax1.set_ylabel('Water Mass Contribution Fraction', fontsize=12, fontweight='bold')
ax1.set_title('(a) Water Mass Structure across Neutral Density Bands', fontsize=13, fontweight='bold', pad=12)
ax1.set_ylim(0, 1.05)
ax1.legend(loc='upper right', frameon=True, facecolor='white', framealpha=0.9, fontsize=10)
ax1.grid(axis='y', linestyle='--', alpha=0.5)

# Subplot 2: DOC_mix vs DOC_obs Scatter Plot
depth_100_1000 = (df_valid[depth_col] >= 100) & (df_valid[depth_col] <= 1000)
depth_1000_2000 = (df_valid[depth_col] > 1000) & (df_valid[depth_col] <= 2000)
depth_other = ~(depth_100_1000 | depth_1000_2000)

ax2.scatter(df_valid.loc[depth_other, 'DOC_mix'], df_valid.loc[depth_other, doc_col], 
            c='gray', alpha=0.3, s=35, label='Other Depths', edgecolors='none')

sc1 = ax2.scatter(df_valid.loc[depth_100_1000, 'DOC_mix'], df_valid.loc[depth_100_1000, doc_col], 
                  c='#27ae60', alpha=0.85, s=60, label='100-1000 m (Biodegradation Zone)', edgecolors='k', linewidth=0.4)

sc2 = ax2.scatter(df_valid.loc[depth_1000_2000, 'DOC_mix'], df_valid.loc[depth_1000_2000, doc_col], 
                  c='#e74c3c', alpha=0.9, s=70, marker='^', label='1000-2000 m (Physical Transport/Aging Zone)', edgecolors='k', linewidth=0.4)

# 1:1 Line
min_val = min(df_valid['DOC_mix'].min(), df_valid[doc_col].min()) - 2
max_val = max(df_valid['DOC_mix'].max(), df_valid[doc_col].max()) + 2
ax2.plot([min_val, max_val], [min_val, max_val], 'k--', linewidth=1.5, label='Conservative 1:1 Mixing Line')

# Text Annotations for Mechanisms
ax2.annotate('Strong Biodegradation\n(DOC_obs < DOC_mix)', 
             xy=(52, 42), xytext=(56, 40),
             arrowprops=dict(facecolor='#27ae60', shrink=0.05, width=1.5, headwidth=8),
             fontsize=10, color='#1e8449', fontweight='bold',
             bbox=dict(boxstyle='round,pad=0.4', facecolor='#e8f8f5', edgecolor='#27ae60', alpha=0.8))

ax2.annotate('Physical Aging & Advection\n(DOC_obs ≈ DOC_mix)', 
             xy=(39, 39), xytext=(41, 33),
             arrowprops=dict(facecolor='#e74c3c', shrink=0.05, width=1.5, headwidth=8),
             fontsize=10, color='#900c3f', fontweight='bold',
             bbox=dict(boxstyle='round,pad=0.4', facecolor='#fdedec', edgecolor='#e74c3c', alpha=0.8))

ax2.set_xlabel('Physical Mixing Expected DOC: $\mathrm{DOC_{mix}}$ ($\mu\mathrm{mol/L}$)', fontsize=12, fontweight='bold')
ax2.set_ylabel('Observed DOC: $\mathrm{DOC_{obs}}$ ($\mu\mathrm{mol/L}$)', fontsize=12, fontweight='bold')
ax2.set_title('(b) Mechanism Dissection: Physical Mixing vs. Biological Degradation', fontsize=13, fontweight='bold', pad=12)
ax2.set_xlim(min_val, max_val)
ax2.set_ylim(min_val, max_val)
ax2.legend(loc='upper left', frameon=True, facecolor='white', framealpha=0.9, fontsize=9.5)
ax2.grid(True, linestyle='--', alpha=0.5)

plt.tight_layout()
print(f"Saving high-res plot to {output_png}...")
plt.savefig(output_png, dpi=300)
plt.close()

print("eOMP analysis and visualization completed successfully!")
