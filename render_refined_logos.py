import math, os
import numpy as np
from PIL import Image, ImageDraw, ImageFont

base_path = r'e:\PRANAV\pwa apps\mpptjournal\logo\final logo_original_backup.png'
base = Image.open(base_path).convert('RGBA')
w, h = base.size
cx, cy = w / 2.0, h / 2.0

SCALE = 4
SW, SH = w * SCALE, h * SCALE
scx, scy = cx * SCALE, cy * SCALE

base_4x = base.resize((SW, SH), Image.Resampling.LANCZOS)
arr_base = np.array(base_4x)

y_idx, x_idx = np.ogrid[:SH, :SW]
dist = np.sqrt((x_idx - scx)**2 + (y_idx - scy)**2)
ring_mask = (dist >= 335.5 * SCALE) & (dist <= 444.5 * SCALE)

DARK_BURGUNDY = (92, 31, 38, 255)
ANTIQUE_GOLD = (186, 146, 68, 255)
BRIGHT_GOLD = (205, 168, 92, 255)
LIGHT_GOLD = (235, 208, 145, 255)

font_geo_bold = lambda sz: ImageFont.truetype(r'C:\Windows\Fonts\georgiab.ttf', int(sz * SCALE))
font_book_bold = lambda sz: ImageFont.truetype(r'C:\Windows\Fonts\BOOKOSB.TTF', int(sz * SCALE))
font_camb_bold = lambda sz: ImageFont.truetype(r'C:\Windows\Fonts\cambriab.ttf', int(sz * SCALE))

def draw_curved_top(img, text, radius, font, color, center_angle_deg=-90, tracking=1.02, bullet_pad=0.8):
    dummy = Image.new('RGBA', (10, 10))
    d_draw = ImageDraw.Draw(dummy)
    
    char_widths = []
    for c in text:
        if c == '•':
            char_widths.append(d_draw.textlength(c, font=font) + font.size * bullet_pad)
        elif c == ' ':
            char_widths.append(font.size * 0.38)
        else:
            char_widths.append(d_draw.textlength(c, font=font) * tracking)
            
    total_arc = sum(char_widths)
    total_angle = total_arc / radius
    start_angle = math.radians(center_angle_deg) - (total_angle / 2.0)
    
    current_angle = start_angle
    for i, c in enumerate(text):
        cw = char_widths[i]
        if c == ' ':
            current_angle += cw / radius
            continue
            
        char_center_angle = current_angle + (cw / 2.0) / radius
        bbox = d_draw.textbbox((0, 0), c, font=font)
        w_c = max(1, bbox[2] - bbox[0] + 16)
        h_c = max(1, bbox[3] - bbox[1] + 16)
        
        char_img = Image.new('RGBA', (w_c, h_c), (0, 0, 0, 0))
        c_draw = ImageDraw.Draw(char_img)
        c_draw.text((-bbox[0] + 8, -bbox[1] + 8), c, font=font, fill=color)
        
        rot_deg = -90 - math.degrees(char_center_angle)
        rotated = char_img.rotate(rot_deg, resample=Image.Resampling.BICUBIC, expand=True)
        
        px = scx + radius * math.cos(char_center_angle) - (rotated.width / 2.0)
        py = scy + radius * math.sin(char_center_angle) - (rotated.height / 2.0)
        
        img.alpha_composite(rotated, (int(px), int(py)))
        current_angle += cw / radius

def draw_curved_bottom(img, text, radius, font, color, center_angle_deg=90, tracking=1.02, bullet_pad=0.8):
    dummy = Image.new('RGBA', (10, 10))
    d_draw = ImageDraw.Draw(dummy)
    
    char_widths = []
    for c in text:
        if c == '•':
            char_widths.append(d_draw.textlength(c, font=font) + font.size * bullet_pad)
        elif c == ' ':
            char_widths.append(font.size * 0.38)
        else:
            char_widths.append(d_draw.textlength(c, font=font) * tracking)
            
    total_arc = sum(char_widths)
    total_angle = total_arc / radius
    start_angle = math.radians(center_angle_deg) + (total_angle / 2.0)
    
    current_angle = start_angle
    for i, c in enumerate(text):
        cw = char_widths[i]
        if c == ' ':
            current_angle -= cw / radius
            continue
            
        char_center_angle = current_angle - (cw / 2.0) / radius
        bbox = d_draw.textbbox((0, 0), c, font=font)
        w_c = max(1, bbox[2] - bbox[0] + 16)
        h_c = max(1, bbox[3] - bbox[1] + 16)
        
        char_img = Image.new('RGBA', (w_c, h_c), (0, 0, 0, 0))
        c_draw = ImageDraw.Draw(char_img)
        c_draw.text((-bbox[0] + 8, -bbox[1] + 8), c, font=font, fill=color)
        
        rot_deg = 90 - math.degrees(char_center_angle)
        rotated = char_img.rotate(rot_deg, resample=Image.Resampling.BICUBIC, expand=True)
        
        px = scx + radius * math.cos(char_center_angle) - (rotated.width / 2.0)
        py = scy + radius * math.sin(char_center_angle) - (rotated.height / 2.0)
        
        img.alpha_composite(rotated, (int(px), int(py)))
        current_angle -= cw / radius

# ==========================================
# CANDIDATE 1: Master Sovereign Edition
# Top: Title Case Deep Burgundy (reduced size, balanced arc)
# Bottom: Bookman Old Style Bold Deep Burgundy
# Rim: Gold Website arc
# ==========================================
arr1 = arr_base.copy()
arr1[ring_mask] = [255, 255, 255, 255]
img1 = Image.fromarray(arr1)

draw_curved_top(img1, "Research • Practice • Better Health", 
                radius=390 * SCALE, font=font_geo_bold(22.0), 
                color=DARK_BURGUNDY, tracking=1.02, bullet_pad=1.2)

draw_curved_bottom(img1, "MODERN PHARMACY PRAXIS AND THERAPEUTICS", 
                   radius=373 * SCALE, font=font_book_bold(27.0), 
                   color=DARK_BURGUNDY, tracking=1.02)

draw_curved_bottom(img1, "• www.mpptjournal.com •", 
                   radius=423 * SCALE, font=font_geo_bold(14.5), 
                   color=BRIGHT_GOLD, tracking=1.08, bullet_pad=1.0)

out1 = img1.resize((w, h), Image.Resampling.LANCZOS)
out1.save(r'e:\PRANAV\pwa apps\mpptjournal\logo\logo_option1_sovereign.png')
print("Option 1 saved successfully.")

# ==========================================
# CANDIDATE 2: Oxford Classical Edition
# Top: Roman All-Caps Antique Gold (reduced size, elegant tracking)
# Bottom: Bookman Old Style Bold Deep Burgundy
# Rim: Gold Website arc
# ==========================================
arr2 = arr_base.copy()
arr2[ring_mask] = [255, 255, 255, 255]
img2 = Image.fromarray(arr2)

draw_curved_top(img2, "RESEARCH • PRACTICE • BETTER HEALTH", 
                radius=390 * SCALE, font=font_book_bold(19.0), 
                color=ANTIQUE_GOLD, tracking=1.08, bullet_pad=1.4)

draw_curved_bottom(img2, "MODERN PHARMACY PRAXIS AND THERAPEUTICS", 
                   radius=373 * SCALE, font=font_book_bold(27.0), 
                   color=DARK_BURGUNDY, tracking=1.02)

draw_curved_bottom(img2, "• www.mpptjournal.com •", 
                   radius=423 * SCALE, font=font_geo_bold(14.5), 
                   color=BRIGHT_GOLD, tracking=1.08, bullet_pad=1.0)

out2 = img2.resize((w, h), Image.Resampling.LANCZOS)
out2.save(r'e:\PRANAV\pwa apps\mpptjournal\logo\logo_option2_oxford.png')
print("Option 2 saved successfully.")

# ==========================================
# CANDIDATE 3: Imperial Crest Edition
# Top: Title Case Deep Burgundy
# Bottom: Bookman Old Style Bold at Full Width (r=390)
# Website: Centered inside burgundy core below laurel wreath
# ==========================================
arr3 = arr_base.copy()
arr3[ring_mask] = [255, 255, 255, 255]
img3 = Image.fromarray(arr3)

draw_curved_top(img3, "Research • Practice • Better Health", 
                radius=390 * SCALE, font=font_geo_bold(22.5), 
                color=DARK_BURGUNDY, tracking=1.02, bullet_pad=1.2)

draw_curved_bottom(img3, "MODERN PHARMACY PRAXIS AND THERAPEUTICS", 
                   radius=390 * SCALE, font=font_book_bold(28.5), 
                   color=DARK_BURGUNDY, tracking=1.03)

# Draw website curved inside the burgundy core
draw_curved_bottom(img3, "www.mpptjournal.com", 
                   radius=306 * SCALE, font=font_geo_bold(15.5), 
                   color=LIGHT_GOLD, tracking=1.06)

out3 = img3.resize((w, h), Image.Resampling.LANCZOS)
out3.save(r'e:\PRANAV\pwa apps\mpptjournal\logo\logo_option3_imperial.png')
print("Option 3 saved successfully.")

# ==========================================
# CANDIDATE 4: Cambridge Prestige Edition
# Top: Title Case Antique Gold (reduced size)
# Bottom: Georgia Bold Deep Burgundy
# Rim: Gold Website arc
# ==========================================
arr4 = arr_base.copy()
arr4[ring_mask] = [255, 255, 255, 255]
img4 = Image.fromarray(arr4)

draw_curved_top(img4, "Research • Practice • Better Health", 
                radius=390 * SCALE, font=font_geo_bold(22.0), 
                color=ANTIQUE_GOLD, tracking=1.03, bullet_pad=1.2)

draw_curved_bottom(img4, "MODERN PHARMACY PRAXIS AND THERAPEUTICS", 
                   radius=373 * SCALE, font=font_geo_bold(26.5), 
                   color=DARK_BURGUNDY, tracking=1.02)

draw_curved_bottom(img4, "• www.mpptjournal.com •", 
                   radius=423 * SCALE, font=font_geo_bold(14.5), 
                   color=BRIGHT_GOLD, tracking=1.08, bullet_pad=1.0)

out4 = img4.resize((w, h), Image.Resampling.LANCZOS)
out4.save(r'e:\PRANAV\pwa apps\mpptjournal\logo\logo_option4_cambridge.png')
print("Option 4 saved successfully.")
