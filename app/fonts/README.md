# Fonts

Self-hosted variable fonts, vendored from the `@fontsource-variable` packages
on npm (both are open licensed: Newsreader and IBM Plex Sans are OFL-1.1).

They are served from this app rather than fetched from Google Fonts, so there
is no third-party request on page load, no layout shift waiting on a CDN, and
builds do not depend on fonts.googleapis.com being reachable.

Only the `latin` subset and the `wght` axis are included, which is what the UI
uses. To refresh them:

    npm i --no-save @fontsource-variable/newsreader @fontsource-variable/ibm-plex-sans
    cp node_modules/@fontsource-variable/newsreader/files/newsreader-latin-wght-{normal,italic}.woff2 app/fonts/
    cp node_modules/@fontsource-variable/ibm-plex-sans/files/ibm-plex-sans-latin-wght-normal.woff2 app/fonts/
