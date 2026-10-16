import { api, IS_FIREFOX } from './browser.js';

const OS_NAMES = { win: 'Windows', mac: 'macOS', linux: 'Linux', cros: 'ChromeOS', android: 'Android', openbsd: 'OpenBSD', fuchsia: 'Fuchsia' };

/**
 * Describes the browser and operating system for diagnostics.
 * Returns { browser, browserVersion, engine, os, osVersion, arch, language,
 *           timeZone, screen, pixelRatio, userAgent, summary }.
 */
export async function getEnvironmentInfo() {
  const ua = navigator.userAgent;
  const info = {
    browser: 'Unknown', browserVersion: '', engine: '', os: '', osVersion: '', arch: '',
    language: navigator.language, languages: [...(navigator.languages || [])],
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    screen: globalThis.screen ? `${screen.width}×${screen.height}` : '',
    pixelRatio: globalThis.devicePixelRatio || 1,
    userAgent: ua,
  };

  try {
    const p = await api.runtime.getPlatformInfo();
    info.os = OS_NAMES[p.os] || p.os;
    info.arch = p.arch;
  } catch { /* not available */ }

  if (IS_FIREFOX && api.runtime.getBrowserInfo) {
    const b = await api.runtime.getBrowserInfo();
    info.browser = b.name; info.browserVersion = b.version; info.engine = 'Gecko';
    const m = ua.match(/Windows NT ([\d.]+)|Mac OS X ([\d_.]+)/);
    if (m) info.osVersion = m[1] ? windowsName(m[1]) : m[2].replace(/_/g, '.');
  } else if (navigator.userAgentData) {
    info.engine = 'Blink';
    try {
      const hi = await navigator.userAgentData.getHighEntropyValues(['fullVersionList', 'platformVersion', 'architecture', 'bitness']);
      const list = hi.fullVersionList || navigator.userAgentData.brands || [];
      const pick = (re) => list.find((b) => re.test(b.brand));
      const brand = pick(/Edge/) || pick(/Opera|OPR/) || pick(/Brave/) || pick(/Vivaldi/) || pick(/Google Chrome/) || pick(/Chromium/);
      if (brand) {
        info.browser = brand.brand.replace('Microsoft Edge', 'Edge').replace('Google Chrome', 'Chrome');
        info.browserVersion = brand.version;
      }
      if (hi.platformVersion) {
        if (info.os === 'Windows') {
          const major = parseInt(hi.platformVersion, 10);
          info.osVersion = major >= 13 ? '11' : major > 0 ? '10' : '7/8';
        } else info.osVersion = hi.platformVersion;
      }
      if (hi.architecture) info.arch = `${hi.architecture}${hi.bitness ? '-' + hi.bitness : ''}`;
    } catch { /* fall back to the UA string below */ }
  }

  if (info.browser === 'Unknown') {
    const m = ua.match(/Edg\/([\d.]+)/) ? ['Edge', ua.match(/Edg\/([\d.]+)/)[1]]
      : ua.match(/Firefox\/([\d.]+)/) ? ['Firefox', ua.match(/Firefox\/([\d.]+)/)[1]]
      : ua.match(/Chrome\/([\d.]+)/) ? ['Chrome', ua.match(/Chrome\/([\d.]+)/)[1]] : null;
    if (m) [info.browser, info.browserVersion] = m;
  }

  info.summary = `${info.browser} ${info.browserVersion} on ${info.os}${info.osVersion ? ' ' + info.osVersion : ''}${info.arch ? ` (${info.arch})` : ''}`;
  return info;
}

function windowsName(nt) {
  return { '10.0': '10/11', '6.3': '8.1', '6.2': '8', '6.1': '7' }[nt] || nt;
}
