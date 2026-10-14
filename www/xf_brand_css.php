<?php
# xf_brand_css.php - serves the active brand's CSS variables as a stylesheet.
# Imported by www/agc/css/custom.css and www/vicidial/css/xf-admin.css.
require_once(dirname(__FILE__)."/xf_brand.php");
header("Content-Type: text/css; charset=utf-8");
header("Cache-Control: no-cache, must-revalidate");
echo "/* X Frontline brand: ".addslashes(xf_brand('company_name'))." / theme ".xf_brand('theme')." */\n";
echo xf_brand_css_rules();
