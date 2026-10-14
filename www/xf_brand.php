<?php
# xf_brand.php - branding helpers for the X Frontline UI
#
# Usage (from www/agc or www/vicidial):
#   require_once(dirname(__FILE__)."/../xf_brand.php");
#   echo xf_brand('company_name');
#   echo xf_brand_logo_tag('login-logo');
#   echo xf_brand_greeting($LOGfullname);

function xf_brand_presets()
	{
	return array(
		'midnight-gold' => array('label'=>'Midnight Gold', 'accent'=>'#d4b46a', 'bg'=>'#0b0e14', 'bg2'=>'#10141c', 'surface'=>'#161b25', 'surface2'=>'#1c2230', 'surface3'=>'#232a3a', 'glow'=>'rgba(212,180,106,0.10)'),
		'royal'         => array('label'=>'Royal Navy',    'accent'=>'#8fc1ff', 'bg'=>'#070b16', 'bg2'=>'#0b1222', 'surface'=>'#111a2e', 'surface2'=>'#16213a', 'surface3'=>'#1d2a48', 'glow'=>'rgba(111,180,255,0.12)'),
		'emerald'       => array('label'=>'Emerald',       'accent'=>'#5fd3a4', 'bg'=>'#07110e', 'bg2'=>'#0b1714', 'surface'=>'#10201b', 'surface2'=>'#152822', 'surface3'=>'#1b322b', 'glow'=>'rgba(63,214,141,0.10)'),
		'ruby'          => array('label'=>'Ruby',          'accent'=>'#f08c9a', 'bg'=>'#13080b', 'bg2'=>'#1a0c10', 'surface'=>'#231218', 'surface2'=>'#2b171e', 'surface3'=>'#351d26', 'glow'=>'rgba(240,140,154,0.10)'),
		'platinum'      => array('label'=>'Platinum',      'accent'=>'#cfd6e0', 'bg'=>'#0e1013', 'bg2'=>'#13161a', 'surface'=>'#1a1e24', 'surface2'=>'#20252c', 'surface3'=>'#282e37', 'glow'=>'rgba(207,214,224,0.08)'),
	);
	}

function xf_brand_custom_file()
	{
	return dirname(__FILE__)."/xf_brand_custom.json";
	}

function xf_brand_all()
	{
	static $brand = null;
	if ($brand !== null) {return $brand;}
	$brand = include(dirname(__FILE__)."/xf_brand_defaults.php");
	$file = xf_brand_custom_file();
	if (is_readable($file))
		{
		$json = json_decode(file_get_contents($file), true);
		if (is_array($json))
			{
			foreach ($json as $k => $v)
				{
				if (array_key_exists($k, $brand)) {$brand[$k] = $v;}
				}
			}
		}
	$presets = xf_brand_presets();
	if (!isset($presets[$brand['theme']])) {$brand['theme'] = 'midnight-gold';}
	if (!preg_match('/^#[0-9a-fA-F]{6}$/', $brand['accent_color'])) {$brand['accent_color'] = '';}
	if (!in_array($brand['corner_style'], array('rounded','soft','sharp'))) {$brand['corner_style'] = 'rounded';}
	if (!in_array($brand['display_font'], array('serif','sans'))) {$brand['display_font'] = 'serif';}
	return $brand;
	}

function xf_brand($key, $default = '')
	{
	$b = xf_brand_all();
	return isset($b[$key]) ? $b[$key] : $default;
	}

function xf_brand_h($key)
	{
	return htmlspecialchars(xf_brand($key), ENT_QUOTES, 'UTF-8');
	}

# Web path of the logo from a page living one level below www/ (agc/ or vicidial/)
function xf_brand_logo_url()
	{
	$logo = xf_brand('logo');
	if (preg_match('#^(https?:)?//#', $logo)) {return $logo;}
	return "../".ltrim($logo, '/');
	}

function xf_brand_logo_tag($class = '', $height = 0)
	{
	if ($height < 1) {$height = (int) xf_brand('logo_height');}
	return "<img src=\"".htmlspecialchars(xf_brand_logo_url(), ENT_QUOTES, 'UTF-8')."\" alt=\"".xf_brand_h('company_name')."\" class=\"xf-brand-logo $class\" style=\"height:{$height}px;width:auto;\" border=\"0\" />";
	}

function xf_brand_title($section = '')
	{
	$t = xf_brand('company_name');
	if (strlen(xf_brand('product_name')) > 0) {$t .= " ".xf_brand('product_name');}
	if (strlen($section) > 0) {$t .= " | $section";}
	return htmlspecialchars($t, ENT_QUOTES, 'UTF-8');
	}

# "Good morning, Alexandra." using the agent's first name and local server time
function xf_brand_greeting($full_name = '')
	{
	$h = (int) date('G');
	if ($h < 5)       {$g = 'Good evening';}
	elseif ($h < 12)  {$g = 'Good morning';}
	elseif ($h < 17)  {$g = 'Good afternoon';}
	else              {$g = 'Good evening';}
	$first = trim(preg_replace('/\s.*$/', '', trim($full_name)));
	if (strlen($first) > 0) {$g .= ", ".htmlspecialchars($first, ENT_QUOTES, 'UTF-8');}
	$g .= ".";
	$suffix = trim(xf_brand('greeting_suffix'));
	if (strlen($suffix) > 0) {$g .= " <span class=\"xf-greeting-suffix\">".htmlspecialchars($suffix, ENT_QUOTES, 'UTF-8')."</span>";}
	return $g;
	}

# Small footer line: support line + footer text + powered by
function xf_brand_footer()
	{
	$parts = array();
	if (strlen(trim(xf_brand('support_line'))) > 0) {$parts[] = xf_brand_h('support_line');}
	if (strlen(trim(xf_brand('footer_text'))) > 0)  {$parts[] = xf_brand_h('footer_text');}
	if (xf_brand('show_powered_by'))                 {$parts[] = 'Powered by ViciDial';}
	if (count($parts) < 1) {return '';}
	return "<div class=\"xf-brand-footer\">".implode(" &nbsp;&middot;&nbsp; ", $parts)."</div>";
	}

# ---- colour helpers used by xf_brand_css.php
function xf_hex_to_rgb($hex)
	{
	$hex = ltrim($hex, '#');
	return array(hexdec(substr($hex,0,2)), hexdec(substr($hex,2,2)), hexdec(substr($hex,4,2)));
	}
function xf_rgb_to_hex($r, $g, $b)
	{
	return sprintf('#%02x%02x%02x', max(0,min(255,round($r))), max(0,min(255,round($g))), max(0,min(255,round($b))));
	}
# mix a colour towards white (amt>0) or black (amt<0); amt in -1..1
function xf_shade($hex, $amt)
	{
	list($r,$g,$b) = xf_hex_to_rgb($hex);
	$t = $amt > 0 ? 255 : 0; $a = abs($amt);
	return xf_rgb_to_hex($r + ($t-$r)*$a, $g + ($t-$g)*$a, $b + ($t-$b)*$a);
	}
function xf_rgba($hex, $alpha)
	{
	list($r,$g,$b) = xf_hex_to_rgb($hex);
	return "rgba($r, $g, $b, $alpha)";
	}
# dark text for light accents, ivory for dark accents
function xf_contrast_text($hex)
	{
	list($r,$g,$b) = xf_hex_to_rgb($hex);
	$lum = (0.2126*$r + 0.7152*$g + 0.0722*$b) / 255;
	return $lum > 0.55 ? '#15120a' : '#f7f3ea';
	}

# Returns the CSS custom-property block for the active brand (no <style> tag)
function xf_brand_css_rules()
	{
	$b = xf_brand_all();
	$presets = xf_brand_presets();
	$p = $presets[$b['theme']];
	$accent = strlen($b['accent_color']) ? $b['accent_color'] : $p['accent'];
	$radius = array('rounded'=>array(18,12,8), 'soft'=>array(10,8,6), 'sharp'=>array(4,3,2));
	$r = $radius[$b['corner_style']];
	$display = ($b['display_font'] == 'sans')
		? '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
		: '"Playfair Display", "Cormorant Garamond", Georgia, "Times New Roman", serif';
	$css  = ":root {\n";
	$css .= "  --xf-bg: {$p['bg']};\n  --xf-bg-2: {$p['bg2']};\n  --xf-surface: {$p['surface']};\n  --xf-surface-2: {$p['surface2']};\n  --xf-surface-3: {$p['surface3']};\n";
	$css .= "  --xf-gold: $accent;\n  --xf-gold-2: ".xf_shade($accent, 0.28).";\n  --xf-gold-deep: ".xf_shade($accent, -0.35).";\n  --xf-gold-soft: ".xf_rgba($accent, 0.14).";\n";
	$css .= "  --xf-accent-text: ".xf_contrast_text($accent).";\n  --xf-glow: {$p['glow']};\n";
	$css .= "  --xf-radius-lg: {$r[0]}px;\n  --xf-radius: {$r[1]}px;\n  --xf-radius-sm: {$r[2]}px;\n";
	$css .= "  --xf-font-display: $display;\n";
	$css .= "}\n";
	$css .= "body { background-image: radial-gradient(1200px 600px at 10% -10%, var(--xf-glow), transparent 60%), radial-gradient(900px 500px at 100% 0%, rgba(111,180,255,0.06), transparent 55%), linear-gradient(180deg, var(--xf-bg-2) 0%, var(--xf-bg) 100%); }\n";
	# accent-coloured buttons must stay readable whatever the accent
	$css .= ".button, .blue, .blue:hover, .xf-btn, a.xf-btn, input[type=\"submit\"], input[type=\"button\"], input[type=\"reset\"], button { color: var(--xf-accent-text); background: linear-gradient(180deg, var(--xf-gold-2) 0%, var(--xf-gold) 60%, var(--xf-gold-deep) 100%); border-color: ".xf_rgba($accent, 0.55)."; box-shadow: 0 6px 18px ".xf_rgba($accent, 0.22).", 0 1px 0 rgba(255,255,255,0.35) inset; }\n";
	$css .= ".button a, .xf-btn:hover, a.xf-btn:hover { color: var(--xf-accent-text) !important; }\n";
	$css .= "table[width=\"160\"][bgcolor=\"#015B91\" i] > tbody > tr:not([bgcolor]) > td[bgcolor] > a, table[width=\"160\"][bgcolor=\"#015B91\" i] > tbody > tr:not([bgcolor]) > td[bgcolor] > a font { color: var(--xf-accent-text) !important; }\n";
	$css .= ".xf-brand-footer { margin: 14px auto 0; text-align: center; font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: var(--xf-text-3); }\n";
	$css .= ".xf-greeting { display: block; font-size: 13.5px; color: var(--xf-text); margin-bottom: 2px; }\n.xf-greeting-suffix { color: var(--xf-text-2); }\n";
	$css .= ".xf-daily-focus { display: inline-block; margin-top: 6px; padding: 4px 12px; border-radius: 999px; background: var(--xf-gold-soft); border: 1px solid ".xf_rgba($accent, 0.35)."; color: var(--xf-gold-2); font-size: 12px; }\n";
	$css .= ".xf-login-brand { display: block; margin: 2px 0 0; font-size: 12px; letter-spacing: .2em; text-transform: uppercase; color: var(--xf-text-2); }\n.xf-login-tagline { display: block; margin: 8px 0 0; font-size: 13px; color: var(--xf-text-3); }\n";
	return $css;
	}
