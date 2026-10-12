# FjordMail artwork

Master: `icon-master.png`, generated as a new standalone image with the built-in image-generation tool. FjordHub and FjordParcel masters were used as style references only. No existing app artwork was replaced.

Concept: polished rounded petrol/teal tile, an icy-white envelope and turquoise flap accent. Primary UI accent `#75d5dc`, deep petrol `#0c343c`. Keep the entire master including transparency.

`exports.json` lists 32 production assets in `web/public/logos`: PNG icons 16–1024, ICO favicon, ICNS desktop icon, Apple touch icon, PWA maskable icon and horizontal/stacked/social wordmarks. Wordmarks have dark, light and transparent versions in PNG and SVG. SVG wordmarks are layout wrappers embedding raster artwork, not editable vector originals.

Rebuild with `python scripts/build_brand.py` using Pillow and Playwright Chromium. Package with `python scripts/package_brand.py`. The archive contains the master, exporter configuration, this description and all exports.
