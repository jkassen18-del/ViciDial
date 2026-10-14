<?php
# welcome.php - VICIDIAL welcome page
# 
# Copyright (C) 2008  Matt Florell <vicidial@gmail.com>    LICENSE: AGPLv2
#

require_once(dirname(__FILE__)."/../xf_brand.php");
echo "<!DOCTYPE html>\n<html>\n<head>\n<meta charset=\"utf-8\">\n<title>".xf_brand_title('Welcome')."</title>\n";
echo "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n";
echo "<link rel=\"stylesheet\" href=\"../agc/css/xf-theme.css\">\n<link rel=\"stylesheet\" href=\"../xf_brand_css.php\">\n";
echo "<style>
  body { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px; }
  .xf-welcome { width: 440px; max-width: 100%; text-align: center; padding: 40px 40px 34px; border-radius: 24px; position: relative; animation: xf-fade-up .45s ease both; }
  .xf-welcome::before { content: ''; position: absolute; left: 10%; right: 10%; top: -1px; height: 1px; background: linear-gradient(90deg, transparent, rgba(212,180,106,.9), transparent); }
  .xf-welcome .xf-eyebrow { display: block; margin-top: 6px; }
  .xf-welcome img { height: 64px; width: auto; margin-bottom: 14px; filter: drop-shadow(0 6px 20px rgba(0,0,0,.5)); }
  .xf-welcome h1 { font-size: 28px; margin: 6px 0 4px; }
  .xf-welcome p { color: var(--xf-text-2); margin: 0 0 26px; font-size: 13.5px; }
  .xf-welcome .xf-links { display: flex; flex-direction: column; gap: 10px; }
  .xf-welcome a.xf-btn { font-size: 13px; letter-spacing: .12em; text-transform: uppercase; padding: 13px 20px; }
  .xf-welcome .xf-foot { margin-top: 22px; font-size: 11px; color: var(--xf-text-3); letter-spacing: .08em; text-transform: uppercase; }
</style>\n";
echo "</head>\n";
echo "<body>\n";
echo "<div class=\"xf-card xf-welcome\">\n";
echo xf_brand_logo_tag('welcome-logo', 64)."\n";
echo "<span class=\"xf-eyebrow\">".xf_brand_h('company_name')."</span>\n";
echo "<h1>".xf_brand_h('product_name')."</h1>\n";
echo "<p>".xf_brand_h('tagline')."</p>\n";
echo "<div class=\"xf-links\">\n";
echo "<a class=\"xf-btn\" href=\"../agc/vicidial.php\">Agent Login</a>\n";
echo "<a class=\"xf-btn ghost\" href=\"../agc/timeclock.php?referrer=welcome\">Timeclock</a>\n";
echo "<a class=\"xf-btn ghost\" href=\"../vicidial/admin.php\">Administration</a>\n";
echo "</div>\n";
echo xf_brand_footer()."\n";
echo "</div>\n";
echo "</body>\n\n";
echo "</html>\n\n";

?>