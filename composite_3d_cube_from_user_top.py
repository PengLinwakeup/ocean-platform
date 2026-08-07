import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont
import sys

sys.stdout.reconfigure(encoding='utf-8')

print("1. Loading User Surface Chlorophyll Map and Matching Bottom OMZ Map...")
top_img_path = r'C:\Users\Windows\.gemini\antigravity-ide\brain\a79f783e-9686-45f4-a2f0-5aacae89af16\media__1785803299908.png'
bot_img_path = r'user_template_bottom_omz.png'

img_top = cv2.imread(top_img_path, cv2.IMREAD_UNCHANGED)
img_bot = cv2.imread(bot_img_path, cv2.IMREAD_UNCHANGED)

# Ensure RGBA format
if img_top.shape[2] == 3:
    img_top = cv2.cvtColor(img_top, cv2.COLOR_BGR2BGRA)
if img_bot.shape[2] == 3:
    img_bot = cv2.cvtColor(img_bot, cv2.COLOR_BGR2BGRA)

h_top, w_top = img_top.shape[:2]
h_bot, w_bot = img_bot.shape[:2]

# High-Res Canvas
W, H = 2600, 1600
canvas = np.zeros((H, W, 4), dtype=np.uint8)

# Dark Slate Gradient Background matching user reference
for y in range(H):
    r = int(14 + (28 - 14) * (y / H))
    g = int(30 + (45 - 30) * (y / H))
    b = int(45 + (62 - 45) * (y / H))
    canvas[y, :, :] = [r, g, b, 255]

# Define 3D Perspective Plane Destination Coordinates
# Top Layer (Surface Map) - Isometric tilt
top_src = np.float32([[0, 0], [w_top, 0], [w_top, h_top], [0, h_top]])
top_dst = np.float32([
    [240,  120],  # Top-Left
    [2360, 120],  # Top-Right
    [2520, 580],  # Bottom-Right
    [80,   580]   # Bottom-Left
])

# Bottom Layer (OMZ Map) - Parallel skewed plane
bot_src = np.float32([[0, 0], [w_bot, 0], [w_bot, h_bot], [0, h_bot]])
bot_dst = np.float32([
    [240,  700],  # Top-Left
    [2360, 700],  # Top-Right
    [2520, 1160], # Bottom-Right
    [80,   1160]  # Bottom-Left
])

# Compute Perspective Matrices
M_top = cv2.getPerspectiveTransform(top_src, top_dst)
M_bot = cv2.getPerspectiveTransform(bot_src, bot_dst)

warped_top = cv2.warpPerspective(img_top, M_top, (W, H))
warped_bot = cv2.warpPerspective(img_bot, M_bot, (W, H))

# Overlay images
def overlay(bg, fg):
    alpha = fg[:, :, 3] / 255.0
    for c in range(3):
        bg[:, :, c] = (1.0 - alpha) * bg[:, :, c] + alpha * fg[:, :, c]
    return bg

canvas = overlay(canvas, warped_bot)
canvas = overlay(canvas, warped_top)

# Convert to PIL for drawing lines, labels, and drop lines
pil_img = Image.fromarray(canvas)
draw = ImageDraw.Draw(pil_img)

# Helper function to project pixel in source map to warped canvas
def map_pt(x_src, y_src, M):
    pt = np.array([[[x_src, y_src]]], dtype=np.float32)
    warped = cv2.perspectiveTransform(pt, M)
    return float(warped[0, 0, 0]), float(warped[0, 0, 1])

# Extract station points along 25°S on the user's top map
# Station track spans roughly lon 35°E to 115°E along lat -25°S
# Map coords in PlateCarree (x_src in [0, w_top], y_src in [0, h_top])
stations_lon = [40, 50, 60, 72, 85, 100, 112]
stations_lat = -25

# Geographic mapping to pixel coords on source top image (lon [-180, 180], lat [-70, 75])
for st_lon in stations_lon:
    x_norm = (st_lon + 180.0) / 360.0 * w_top
    y_norm = (75.0 - stations_lat) / (75.0 - (-70.0)) * h_top
    
    x_t, y_t = map_pt(x_norm, y_norm, M_top)
    x_b, y_b = map_pt(x_norm, y_norm, M_bot)
    
    # Vertical dashed drop line (pillar)
    num_segments = 25
    for seg in range(num_segments):
        if seg % 2 == 0:
            y1 = y_t + (y_b - y_t) * (seg / num_segments)
            y2 = y_t + (y_b - y_t) * ((seg + 1) / num_segments)
            x1 = x_t + (x_b - x_t) * (seg / num_segments)
            x2 = x_t + (x_b - x_t) * ((seg + 1) / num_segments)
            draw.line([(x1, y1), (x2, y2)], fill=(255, 255, 255, 200), width=2)
            
    # Station dots on top and bottom
    draw.ellipse([x_t-4, y_t-4, x_t+4, y_t+4], fill=(225, 29, 72, 255), outline=(255, 255, 255, 255))
    draw.ellipse([x_b-4, y_b-4, x_b+4, y_b+4], fill=(255, 255, 255, 220))

# Side Depth Axis Labels
draw.text((25, 570), "0m\nSurface", fill=(224, 231, 255), font_size=22)
draw.text((25, 870), "~500m\nOMZ Core\nDepth", fill=(224, 231, 255), font_size=22)
draw.text((25, 1150), "~2000m", fill=(224, 231, 255), font_size=22)

# Save final 3D block
final_output = "final_3d_cube_from_user_top.png"
pil_img.save(final_output)
print(f"Successfully generated final 3D Ocean Cube at: {final_output}")
