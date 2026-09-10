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

def draw_top(img, text, radius, font, color, center_angle_deg=-90, tracking=1.02, bullet_pad=1.0):
    dummy = Image.new('RGBA', (10, 10))
    d_draw = ImageDraw.Draw(dummy)
    
    char_widths = []
    for c in text:
        if c == '•':
            cw = d_draw.textlength(c, font=font) + font.size * bullet_pad
            char_widths.append(cw)
        elif c == ' ':
            char_widths.append(font.size * 0.35)
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

def draw_bottom(img, text, radius, font, color, center_angle_deg=90, tracking=1.02, bullet_pad=1.0):
    dummy = Image.new('RGBA', (10, 10))
    d_draw = ImageDraw.Draw(dummy)
    
    char_widths = []
    for c in text:
        if c == '•':
            cw = d_draw.textlength(c, font=font) + font.size * bullet_pad
            char_widths.append(cw)
        elif c == ' ':
            char_widths.append(font.size * 0.35)
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
# CANDIDATE A: Title Case Burgundy (Refined & Balanced)
# Top: Research • Practice • Better Health (Georgia Bold 22pt, Burgundy)
# Bottom: MODERN PHARMACY PRAXIS AND THERAPEUTICS (Bookman Bold 27.5pt, Burgundy)
# Rim: • www.mpptjournal.com • (Georgia Bold 14.5pt, Antique Gold)
# ==========================================
arr_a = arr_base.copy()
arr_a[ring_mask] = [255, 255, 255, 255]
img_a = Image.fromarray(arr_a)

draw_top(img_a, "Research • Practice • Better Health", 
         radius=390 * SCALE, font=font_geo_bold(22.0), 
         color=DARK_BURGUNDY, tracking=1.02, bullet_pad=1.3)

draw_bottom(img_a, "MODERN PHARMACY PRAXIS AND THERAPEUTICS", 
            radius=373 * SCALE, font=font_book_bold(27.5), 
            color=DARK_BURGUNDY, tracking=1.02)

draw_bottom(img_a, "• www.mpptjournal.com •", 
            radius=423 * SCALE, font=font_geo_bold(14.5), 
            color=BRIGHT_GOLD, tracking=1.08, bullet_pad=1.0)

out_a = img_a.resize((w, h), Image.Resampling.LANCZOS)
out_a.save(r'e:\PRANAV\pwa apps\mpptjournal\logo\logo_candidate_1_titlecase_burgundy.png')
print("Candidate 1 saved.")

# ==========================================
# CANDIDATE B: Title Case Antique Gold (Warm & Prestigious)
# Top: Research • Practice • Better Health (Georgia Bold 22pt, Antique Gold)
# Bottom: MODERN PHARMACY PRAXIS AND THERAPEUTICS (Bookman Bold 27.5pt, Burgundy)
# Rim: • www.mpptjournal.com • (Georgia Bold 14.5pt, Antique Gold)
# ==========================================
arr_b = arr_base.copy()
arr_b[ring_mask] = [255, 255, 255, 255]
img_b = Image.fromarray(arr_b)

draw_top(img_b, "Research • Practice • Better Health", 
         radius=390 * SCALE, font=font_geo_bold(22.0), 
         color=ANTIQUE_GOLD, tracking=1.02, bullet_pad=1.3)

draw_bottom(img_b, "MODERN PHARMACY PRAXIS AND THERAPEUTICS", 
            radius=373 * SCALE, font=font_book_bold(27.5), 
            color=DARK_BURGUNDY, tracking=1.02)

draw_bottom(img_b, "• www.mpptjournal.com •", 
            radius=423 * SCALE, font=font_geo_bold(14.5), 
            color=BRIGHT_GOLD, tracking=1.08, bullet_pad=1.0)

out_b = img_b.resize((w, h), Image.Resampling.LANCZOS)
out_b.save(r'e:\PRANAV\pwa apps\mpptjournal\logo\logo_candidate_2_titlecase_gold.png')
print("Candidate 2 saved.")

# ==========================================
# CANDIDATE C: Oxford All-Caps Gold (The Classical University Standard)
# Top: RESEARCH • PRACTICE • BETTER HEALTH (Bookman Bold 19pt, Antique Gold)
# Bottom: MODERN PHARMACY PRAXIS AND THERAPEUTICS (Bookman Bold 27.5pt, Burgundy)
# Rim: • www.mpptjournal.com • (Georgia Bold 14.5pt, Antique Gold)
# ==========================================
arr_c = arr_base.copy()
arr_c[ring_mask] = [255, 255, 255, 255]
img_c = Image.fromarray(arr_c)

draw_top(img_c, "RESEARCH • PRACTICE • BETTER HEALTH", 
         radius=390 * SCALE, font=font_book_bold(19.0), 
         color=ANTIQUE_GOLD, tracking=1.06, bullet_pad=1.4)

draw_bottom(img_c, "MODERN PHARMACY PRAXIS AND THERAPEUTICS", 
            radius=373 * SCALE, font=font_book_bold(27.5), 
            color=DARK_BURGUNDY, tracking=1.02)

draw_bottom(img_c, "• www.mpptjournal.com •", 
            radius=423 * SCALE, font=font_geo_bold(14.5), 
            color=BRIGHT_GOLD, tracking=1.08, bullet_pad=1.0)

out_c = img_c.resize((w, h), Image.Resampling.LANCZOS)
out_c.save(r'e:\PRANAV\pwa apps\mpptjournal\logo\logo_candidate_3_allcaps_gold.png')
print("Candidate 3 saved.")

# ==========================================
# CANDIDATE D: Imperial Pedestal Edition (Uncluttered White Ring + Pedestal Website)
# Top: Research • Practice • Better Health (Georgia Bold 22.5pt, Burgundy)
# Bottom: MODERN PHARMACY PRAXIS AND THERAPEUTICS (Bookman Bold 28.5pt, Burgundy, r=390)
# Pedestal: www.mpptjournal.com (Light Gold in inner crest)
# ==========================================
arr_d = arr_base.copy()
arr_d[ring_mask] = [255, 255, 255, 255]
img_d = Image.fromarray(arr_d)

draw_top(img_d, "Research • Practice • Better Health", 
         radius=390 * SCALE, font=font_geo_bold(22.5), 
         color=DARK_BURGUNDY, tracking=1.02, bullet_pad=1.3)

draw_bottom(img_d, "MODERN PHARMACY PRAXIS AND THERAPEUTICS", 
            radius=390 * SCALE, font=font_book_bold(28.5), 
            color=DARK_BURGUNDY, tracking=1.02)

draw_bottom(img_d, "www.mpptjournal.com", 
            radius=306 * SCALE, font=font_geo_bold(15.0), 
            color=LIGHT_GOLD, tracking=1.06)

out_d = img_d.resize((w, h), Image.Resampling.LANCZOS)
out_d.save(r'e:\PRANAV\pwa apps\mpptjournal\logo\logo_candidate_4_pedestal_website.png')
print("Candidate 4 saved.")
