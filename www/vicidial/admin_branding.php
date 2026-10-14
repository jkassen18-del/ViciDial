<?php
# admin_branding.php - X Frontline branding editor
#
# Lets an administrator (user level 9) set the company name, logo, theme,
# accent colour and personal messages used across the agent console, the
# administration screens and the welcome page. Settings are stored in
# www/xf_brand_custom.json; logos are stored in www/agc/images/brand/.

require("dbconnect.php");
require_once(dirname(__FILE__)."/../xf_brand.php");

$PHP_AUTH_USER = isset($_SERVER['PHP_AUTH_USER']) ? $_SERVER['PHP_AUTH_USER'] : '';
$PHP_AUTH_PW   = isset($_SERVER['PHP_AUTH_PW'])   ? $_SERVER['PHP_AUTH_PW']   : '';
$PHP_AUTH_USER = preg_replace("/[^0-9a-zA-Z]/", "", $PHP_AUTH_USER);
$PHP_AUTH_PW   = preg_replace("/[^0-9a-zA-Z]/", "", $PHP_AUTH_PW);

$auth = 0;
if ( (strlen($PHP_AUTH_USER) > 1) and (strlen($PHP_AUTH_PW) > 1) )
	{
	$stmt="SELECT count(*) from vicidial_users where user='$PHP_AUTH_USER' and pass='$PHP_AUTH_PW' and user_level > 8 and active='Y';";
	$rslt=mysql_query($stmt, $link);
	$row=mysql_fetch_row($rslt);
	$auth=$row[0];
	}
if ($auth < 1)
	{
	Header("WWW-Authenticate: Basic realm=\"VICI-PROJECTS\"");
	Header("HTTP/1.0 401 Unauthorized");
	echo "Invalid Username/Password, or your user level is not high enough to edit branding.\n";
	exit;
	}

$custom_file = xf_brand_custom_file();
$logo_dir    = dirname(__FILE__)."/../agc/images/brand";
$notice = ''; $error = '';

$text_fields = array('company_name','product_name','tagline','login_message','greeting_suffix','daily_focus','support_line','footer_text');

if (isset($_POST['xf_save']))
	{
	$current = xf_brand_all();
	$new = array();
	foreach ($text_fields as $f)
		{
		$v = isset($_POST[$f]) ? $_POST[$f] : '';
		$v = trim(strip_tags($v));
		$new[$f] = substr($v, 0, 200);
		}
	$presets = xf_brand_presets();
	$new['theme'] = (isset($_POST['theme']) and isset($presets[$_POST['theme']])) ? $_POST['theme'] : 'midnight-gold';
	$new['accent_color'] = (isset($_POST['accent_color']) and preg_match('/^#[0-9a-fA-F]{6}$/', $_POST['accent_color']) and empty($_POST['accent_default'])) ? strtolower($_POST['accent_color']) : '';
	$new['corner_style'] = (isset($_POST['corner_style']) and in_array($_POST['corner_style'], array('rounded','soft','sharp'))) ? $_POST['corner_style'] : 'rounded';
	$new['display_font'] = (isset($_POST['display_font']) and $_POST['display_font'] == 'sans') ? 'sans' : 'serif';
	$new['show_powered_by'] = isset($_POST['show_powered_by']) ? 1 : 0;
	$new['logo_height'] = max(24, min(140, (int) (isset($_POST['logo_height']) ? $_POST['logo_height'] : 56)));
	$new['logo'] = $current['logo'];

	if (isset($_POST['logo_url']) and strlen(trim($_POST['logo_url'])) > 0)
		{
		$u = trim($_POST['logo_url']);
		if (preg_match('#^(https?://|[A-Za-z0-9_./-]+)$#', $u) and strpos($u, '..') === false)
			{$new['logo'] = $u;}
		else
			{$error .= "Logo path was ignored: use a path below www/ or an http(s) URL. ";}
		}
	if (isset($_POST['logo_reset'])) {$new['logo'] = 'agc/images/xf-logo.svg';}

	if (isset($_FILES['logo_file']) and is_uploaded_file($_FILES['logo_file']['tmp_name']))
		{
		$name = strtolower($_FILES['logo_file']['name']);
		$ext  = pathinfo($name, PATHINFO_EXTENSION);
		$allowed = array('png','jpg','jpeg','gif','svg','webp');
		if (!in_array($ext, $allowed))
			{$error .= "Logo upload ignored: use PNG, JPG, GIF, SVG or WEBP. ";}
		elseif ($_FILES['logo_file']['size'] > 2097152)
			{$error .= "Logo upload ignored: file is larger than 2 MB. ";}
		else
			{
			if (!is_dir($logo_dir)) {@mkdir($logo_dir, 0755, true);}
			$target = "$logo_dir/logo.$ext";
			if (@move_uploaded_file($_FILES['logo_file']['tmp_name'], $target))
				{
				@chmod($target, 0644);
				$new['logo'] = "agc/images/brand/logo.$ext";
				}
			else
				{$error .= "Could not write the logo to $logo_dir (check that the web server can write there). ";}
			}
		}

	$json = json_encode($new);
	if (@file_put_contents($custom_file, $json) === false)
		{
		$error .= "Could not save ".htmlspecialchars($custom_file).". Make the file writable by the web server, for example: chown apache ".dirname($custom_file)." or chmod 666 $custom_file";
		}
	else
		{
		$notice = "Branding saved. Agents will see the new look the next time their console loads.";
		$SQL_log = addslashes(substr($json, 0, 2000));
		$NOW_TIME = date("Y-m-d H:i:s");
		$ip = getenv("REMOTE_ADDR");
		$stmt="INSERT INTO vicidial_admin_log set event_date='$NOW_TIME', user='$PHP_AUTH_USER', ip_address='$ip', event_section='ADMIN', event_type='MODIFY', record_id='BRANDING', event_code='ADMIN MODIFY BRANDING', event_sql=\"$SQL_log\", event_notes='';";
		@mysql_query($stmt, $link);
		}
	# reload merged values
	$GLOBALS['xf_brand_reload'] = 1;
	}

# re-read after a save (xf_brand_all caches); cheap enough to re-include
$b = include(dirname(__FILE__)."/../xf_brand_defaults.php");
if (is_readable($custom_file))
	{
	$j = json_decode(file_get_contents($custom_file), true);
	if (is_array($j)) {foreach ($j as $k=>$v) {if (array_key_exists($k,$b)) {$b[$k]=$v;}}}
	}
$presets = xf_brand_presets();
if (!isset($presets[$b['theme']])) {$b['theme']='midnight-gold';}
$effective_accent = strlen($b['accent_color']) ? $b['accent_color'] : $presets[$b['theme']]['accent'];
$writable = (file_exists($custom_file) ? is_writable($custom_file) : is_writable(dirname($custom_file)));

function h($s) {return htmlspecialchars($s, ENT_QUOTES, 'UTF-8');}

header("Content-type: text/html; charset=utf-8");
echo "<!DOCTYPE html>\n<html>\n<head>\n<meta charset=\"utf-8\">\n";
echo "<title>".xf_brand_title('Branding')."</title>\n";
echo "<link rel=stylesheet href=css/xf-admin.css>\n";
?>
<style>
  .xf-brand-wrap { max-width: 1180px; margin: 0 auto; }
  .xf-brand-grid { display: grid; grid-template-columns: 1.1fr .9fr; gap: 22px; align-items: start; }
  .xf-brand-form .row { display: grid; grid-template-columns: 180px 1fr; gap: 10px 16px; align-items: center; padding: 9px 0; border-bottom: 1px solid var(--xf-line); }
  .xf-brand-form .row:last-child { border-bottom: 0; }
  .xf-brand-form label { font-size: 11px; letter-spacing: .12em; text-transform: uppercase; color: var(--xf-text-3); }
  .xf-brand-form input[type=text], .xf-brand-form select { width: 100%; }
  .xf-brand-form small { display: block; color: var(--xf-text-3); font-size: 11.5px; margin-top: 4px; }
  .xf-brand-form input[type=color] { width: 44px; height: 32px; padding: 0; border: 1px solid var(--xf-line-strong); border-radius: 8px; background: transparent; vertical-align: middle; }
  .xf-swatches { display: flex; gap: 8px; flex-wrap: wrap; }
  .xf-swatch { display: inline-flex; align-items: center; gap: 8px; padding: 6px 10px; border-radius: 999px; border: 1px solid var(--xf-line-strong); cursor: pointer; font-size: 12px; color: var(--xf-text-2); }
  .xf-swatch input { margin: 0; }
  .xf-swatch i { width: 14px; height: 14px; border-radius: 50%; display: inline-block; }
  .xf-notice { padding: 10px 14px; border-radius: var(--xf-radius-sm); margin-bottom: 14px; font-size: 13px; }
  .xf-notice.ok { background: var(--xf-live-soft); color: var(--xf-live); border: 1px solid rgba(63,214,141,.35); }
  .xf-notice.err { background: var(--xf-dead-soft); color: var(--xf-dead); border: 1px solid rgba(255,107,107,.35); }
  .xf-preview { position: sticky; top: 18px; }
  .xf-preview .mock { border-radius: var(--xf-radius-lg); border: 1px solid var(--xf-line); padding: 20px; background: linear-gradient(180deg, rgba(255,255,255,.04), rgba(255,255,255,.015)); }
  .xf-preview .mock .pill { display: inline-block; padding: 5px 12px; border-radius: 999px; font-size: 11px; letter-spacing: .14em; text-transform: uppercase; }
  .xf-preview .mock h2 { font-family: var(--xf-font-display); font-weight: 500; font-size: 24px; margin: 10px 0 2px; }
  .xf-preview .mock .stats { display: flex; gap: 14px; margin-top: 14px; }
  .xf-preview .mock .stats div { flex: 1; padding: 10px 12px; border-radius: var(--xf-radius); border: 1px solid var(--xf-line); font-size: 10.5px; letter-spacing: .12em; text-transform: uppercase; color: var(--xf-text-3); }
  .xf-preview .mock .stats strong { display: block; font-family: var(--xf-font-display); font-size: 22px; font-weight: 500; color: var(--xf-text); letter-spacing: 0; text-transform: none; }
  .xf-preview .mock .btnrow { display: flex; gap: 10px; margin-top: 16px; }
</style>
</head>
<body>
<?php
$short_header = 1;
$reports_only_user = 0;
require("admin_header.php");
?>
<div class="xf-brand-wrap">
  <span class="xf-eyebrow">Personalize</span>
  <h1 style="margin:4px 0 4px">Branding</h1>
  <p>Give the console your company's identity. Changes apply to the agent login, the agent console, administration screens and the welcome page.</p>

  <?php if ($notice) {echo "<div class=\"xf-notice ok\">".h($notice)."</div>";} ?>
  <?php if ($error)  {echo "<div class=\"xf-notice err\">".$error."</div>";} ?>
  <?php if (!$writable) {echo "<div class=\"xf-notice err\">The settings file is not writable by the web server, so saving will fail. Fix with: <code>touch ".h($custom_file)." && chown ".h(function_exists('posix_geteuid') && function_exists('posix_getpwuid') ? posix_getpwuid(posix_geteuid())['name'] : 'apache')." ".h($custom_file)."</code></div>";} ?>

  <div class="xf-brand-grid">
    <form class="xf-card xf-brand-form" method="post" enctype="multipart/form-data" action="admin_branding.php" id="brandForm">
      <div class="row"><label>Company name</label><div><input type="text" name="company_name" id="company_name" maxlength="80" value="<?php echo h($b['company_name']) ?>"></div></div>
      <div class="row"><label>Product name</label><div><input type="text" name="product_name" id="product_name" maxlength="80" value="<?php echo h($b['product_name']) ?>"><small>Shown next to the company name, e.g. "Contact Center".</small></div></div>
      <div class="row"><label>Tagline</label><div><input type="text" name="tagline" id="tagline" maxlength="140" value="<?php echo h($b['tagline']) ?>"></div></div>

      <div class="row"><label>Logo</label><div>
        <div style="display:flex;align-items:center;gap:14px;margin-bottom:8px"><img src="<?php echo h(xf_brand_logo_url()) ?>" alt="" style="height:44px;width:auto;padding:6px 10px;border:1px solid var(--xf-line);border-radius:10px;background:rgba(0,0,0,.25)"><span style="font-size:12px;color:var(--xf-text-3)"><?php echo h($b['logo']) ?></span></div>
        <input type="file" name="logo_file" accept=".png,.jpg,.jpeg,.gif,.svg,.webp">
        <small>Upload a PNG, SVG, JPG, GIF or WEBP up to 2 MB. Transparent SVG or PNG looks best on the dark surfaces.</small>
        <input type="text" name="logo_url" placeholder="…or a path below www/ (agc/images/brand/mylogo.png) or an https:// URL" style="margin-top:8px">
        <label style="display:inline-flex;align-items:center;gap:6px;margin-top:8px;text-transform:none;letter-spacing:0;font-size:12.5px;color:var(--xf-text-2)"><input type="checkbox" name="logo_reset" value="1"> Reset to the default wordmark</label>
      </div></div>
      <div class="row"><label>Logo height</label><div><input type="text" name="logo_height" id="logo_height" size="4" maxlength="3" value="<?php echo (int)$b['logo_height'] ?>" style="width:80px"> px</div></div>

      <div class="row"><label>Theme</label><div class="xf-swatches">
        <?php foreach ($presets as $k=>$p) { ?>
        <label class="xf-swatch"><input type="radio" name="theme" value="<?php echo $k ?>" <?php if ($b['theme']==$k) echo 'checked'; ?> data-accent="<?php echo $p['accent'] ?>" data-bg="<?php echo $p['surface'] ?>"><i style="background:<?php echo $p['accent'] ?>"></i><?php echo h($p['label']) ?></label>
        <?php } ?>
      </div></div>
      <div class="row"><label>Accent colour</label><div>
        <input type="color" name="accent_color" id="accent_color" value="<?php echo h($effective_accent) ?>">
        <label style="display:inline-flex;align-items:center;gap:6px;margin-left:12px;text-transform:none;letter-spacing:0;font-size:12.5px;color:var(--xf-text-2)"><input type="checkbox" name="accent_default" id="accent_default" value="1" <?php if (!strlen($b['accent_color'])) echo 'checked'; ?>> Use the theme's own accent</label>
        <small>Buttons, highlights and the selected navigation item use this colour. Text on it switches automatically between dark and light for contrast.</small>
      </div></div>
      <div class="row"><label>Corners</label><div><select name="corner_style" id="corner_style">
        <option value="rounded" <?php if ($b['corner_style']=='rounded') echo 'selected'; ?>>Rounded (default)</option>
        <option value="soft" <?php if ($b['corner_style']=='soft') echo 'selected'; ?>>Soft</option>
        <option value="sharp" <?php if ($b['corner_style']=='sharp') echo 'selected'; ?>>Sharp</option>
      </select></div></div>
      <div class="row"><label>Headline typeface</label><div><select name="display_font" id="display_font">
        <option value="serif" <?php if ($b['display_font']=='serif') echo 'selected'; ?>>Editorial serif (default)</option>
        <option value="sans" <?php if ($b['display_font']=='sans') echo 'selected'; ?>>Modern sans-serif</option>
      </select></div></div>

      <div class="row"><label>Login message</label><div><input type="text" name="login_message" id="login_message" maxlength="200" value="<?php echo h($b['login_message']) ?>"><small>Shown under the sign-in button.</small></div></div>
      <div class="row"><label>Agent greeting</label><div><input type="text" name="greeting_suffix" id="greeting_suffix" maxlength="200" value="<?php echo h($b['greeting_suffix']) ?>"><small>Follows "Good morning, &lt;first name&gt;." on the agent console.</small></div></div>
      <div class="row"><label>Today's focus</label><div><input type="text" name="daily_focus" id="daily_focus" maxlength="200" value="<?php echo h($b['daily_focus']) ?>"><small>Optional highlight pinned to the agent console, e.g. a daily target or a note from the floor manager. Leave blank to hide.</small></div></div>
      <div class="row"><label>Support line</label><div><input type="text" name="support_line" maxlength="200" value="<?php echo h($b['support_line']) ?>" placeholder="e.g. Help desk: ext. 200"></div></div>
      <div class="row"><label>Footer text</label><div><input type="text" name="footer_text" maxlength="200" value="<?php echo h($b['footer_text']) ?>" placeholder="e.g. © Your Company Ltd."></div></div>
      <div class="row"><label>Powered by</label><div><label style="display:inline-flex;align-items:center;gap:6px;text-transform:none;letter-spacing:0;font-size:12.5px;color:var(--xf-text-2)"><input type="checkbox" name="show_powered_by" value="1" <?php if ($b['show_powered_by']) echo 'checked'; ?>> Show "Powered by ViciDial" in footers</label></div></div>

      <div class="row"><label></label><div><input type="submit" name="xf_save" value="Save branding"> &nbsp; <a class="xf-btn ghost" href="admin.php?ADD=999998">Back to Admin</a></div></div>
    </form>

    <div class="xf-preview">
      <span class="xf-eyebrow">Live preview</span>
      <div class="mock" id="mock" style="margin-top:8px">
        <div style="display:flex;align-items:center;gap:12px"><img id="pvLogo" src="<?php echo h(xf_brand_logo_url()) ?>" alt="" style="height:36px;width:auto"><div><div id="pvCompany" style="font-weight:600"><?php echo h($b['company_name']) ?></div><div id="pvProduct" style="font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:var(--xf-text-3)"><?php echo h($b['product_name']) ?></div></div></div>
        <span class="pill" id="pvPill" style="margin-top:14px">On call</span>
        <h2 id="pvName">Good afternoon, Alexandra.</h2>
        <div id="pvGreeting" style="color:var(--xf-text-2);font-size:13px"><?php echo h($b['greeting_suffix']) ?></div>
        <div id="pvFocus" class="xf-daily-focus" style="<?php if (!strlen(trim($b['daily_focus']))) echo 'display:none'; ?>"><?php echo h($b['daily_focus']) ?></div>
        <div class="stats"><div>Calls today<strong>42</strong></div><div>Avg talk<strong>3:12</strong></div><div>In queue<strong>3</strong></div></div>
        <div class="btnrow"><span class="xf-btn" id="pvBtn">Ready</span><span class="xf-btn ghost">Logout</span></div>
        <div id="pvTagline" style="margin-top:16px;font-size:12px;color:var(--xf-text-3)"><?php echo h($b['tagline']) ?></div>
      </div>
      <p style="margin-top:12px;font-size:12px;color:var(--xf-text-3)">The preview approximates the agent console header. Save to apply everywhere.</p>
    </div>
  </div>
</div>
<script>
(function(){
  var presets = <?php echo json_encode($presets); ?>;
  function shade(hex, amt){ var r=parseInt(hex.substr(1,2),16),g=parseInt(hex.substr(3,2),16),b=parseInt(hex.substr(5,2),16); var t=amt>0?255:0,a=Math.abs(amt); function c(v){v=Math.round(v+(t-v)*a);return ('0'+Math.max(0,Math.min(255,v)).toString(16)).slice(-2);} return '#'+c(r)+c(g)+c(b); }
  function lum(hex){ var r=parseInt(hex.substr(1,2),16),g=parseInt(hex.substr(3,2),16),b=parseInt(hex.substr(5,2),16); return (0.2126*r+0.7152*g+0.0722*b)/255; }
  function rgba(hex,a){ return 'rgba('+parseInt(hex.substr(1,2),16)+','+parseInt(hex.substr(3,2),16)+','+parseInt(hex.substr(5,2),16)+','+a+')'; }
  function g(id){return document.getElementById(id);}
  function apply(){
    var theme = document.querySelector('input[name=theme]:checked'); var p = presets[theme?theme.value:'midnight-gold'];
    var accent = g('accent_default').checked ? p.accent : g('accent_color').value;
    if (g('accent_default').checked) g('accent_color').value = p.accent;
    var root = document.documentElement.style;
    root.setProperty('--xf-gold', accent); root.setProperty('--xf-gold-2', shade(accent,.28)); root.setProperty('--xf-gold-deep', shade(accent,-.35)); root.setProperty('--xf-gold-soft', rgba(accent,.14));
    root.setProperty('--xf-accent-text', lum(accent)>.55?'#15120a':'#f7f3ea');
    root.setProperty('--xf-bg', p.bg); root.setProperty('--xf-bg-2', p.bg2); root.setProperty('--xf-surface', p.surface); root.setProperty('--xf-surface-2', p.surface2); root.setProperty('--xf-surface-3', p.surface3); root.setProperty('--xf-glow', p.glow);
    var rad = {rounded:[18,12,8], soft:[10,8,6], sharp:[4,3,2]}[g('corner_style').value];
    root.setProperty('--xf-radius-lg', rad[0]+'px'); root.setProperty('--xf-radius', rad[1]+'px'); root.setProperty('--xf-radius-sm', rad[2]+'px');
    root.setProperty('--xf-font-display', g('display_font').value==='sans' ? '"Inter", -apple-system, "Segoe UI", Roboto, Arial, sans-serif' : '"Playfair Display", Georgia, "Times New Roman", serif');
    document.body.style.backgroundImage = 'radial-gradient(1200px 600px at 10% -10%, '+p.glow+', transparent 60%), linear-gradient(180deg, '+p.bg2+' 0%, '+p.bg+' 100%)';
    var btn = g('pvBtn'); btn.style.background = 'linear-gradient(180deg,'+shade(accent,.28)+' 0%,'+accent+' 60%,'+shade(accent,-.35)+' 100%)'; btn.style.color = lum(accent)>.55?'#15120a':'#f7f3ea'; btn.style.borderColor = rgba(accent,.55);
    var pill = g('pvPill'); pill.style.background = rgba(accent,.14); pill.style.border = '1px solid '+rgba(accent,.4); pill.style.color = shade(accent,.28);
    g('pvCompany').textContent = g('company_name').value; g('pvProduct').textContent = g('product_name').value; g('pvTagline').textContent = g('tagline').value; g('pvGreeting').textContent = g('greeting_suffix').value;
    var f = g('daily_focus').value.trim(); g('pvFocus').textContent = f; g('pvFocus').style.display = f ? '' : 'none';
    g('pvLogo').style.height = Math.min(60, Math.max(20, parseInt(g('logo_height').value||56)*0.65)) + 'px';
  }
  document.querySelectorAll('#brandForm input, #brandForm select').forEach(function(el){ el.addEventListener('input', apply); el.addEventListener('change', apply); });
  g('accent_color').addEventListener('input', function(){ g('accent_default').checked = false; apply(); });
  var fileInput = document.querySelector('input[name=logo_file]'); if (fileInput) fileInput.addEventListener('change', function(){ if (this.files && this.files[0]) { g('pvLogo').src = URL.createObjectURL(this.files[0]); } });
  apply();
})();
</script>
</body>
</html>
