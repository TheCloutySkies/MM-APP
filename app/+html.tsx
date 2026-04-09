import { ScrollViewStyleReset } from 'expo-router/html';

// This file is web-only and used to configure the root HTML for every
// web page during static rendering.
// The contents of this function only run in Node.js environments and
// do not have access to the DOM or browser APIs.
export default function Root({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        {/** PWA: dvh + viewport-fit; strict scale reduces accidental pinch zoom on tactical UI. */}
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover, shrink-to-fit=no"
        />
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#0d0f0c" />
        <meta name="mobile-web-app-capable" content="yes" />

        {/* 
          Disable body scrolling on web. This makes ScrollView components work closer to how they do on native. 
          However, body scrolling is often nice to have for mobile web. If you want to enable it, remove this line.
        */}
        <ScrollViewStyleReset />

        {/* Using raw CSS styles as an escape-hatch to ensure the background color never flickers in dark-mode. */}
        <style dangerouslySetInnerHTML={{ __html: responsiveBackground }} />
        {/* Add any additional <head> elements that you want globally available on web... */}
      </head>
      <body>{children}</body>
    </html>
  );
}

/** Dark-first tactical shell — avoids light gray “gutters” on desktop web when OS theme is light. */
const TACTICAL_PAGE_BG = "#0d0f0c";

const responsiveBackground = `
html {
  height: 100%;
  height: 100dvh;
  max-height: 100dvh;
  overflow-x: hidden;
  overscroll-behavior: none;
  margin: 0;
  background-color: ${TACTICAL_PAGE_BG};
}
body {
  height: 100%;
  height: 100dvh;
  max-height: 100dvh;
  overflow-x: hidden;
  overflow-y: hidden;
  overscroll-behavior: none;
  margin: 0;
  -webkit-overflow-scrolling: auto;
  touch-action: manipulation;
  background-color: ${TACTICAL_PAGE_BG};
}
#root, #__expo {
  background-color: ${TACTICAL_PAGE_BG};
  height: 100%;
  height: 100dvh;
  max-height: 100dvh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
/* Leaflet: pan-zoom without scrolling the page */
.leaflet-container {
  touch-action: none;
}
.mm-leaflet-host, [data-mm-leaflet-root] {
  touch-action: none;
}
/* Calcite-style semantic tokens (woodland default). Night Ops overrides via JS from useDesignTokensWeb. */
:root {
  --mm-color-background: #0d0f0c;
  --mm-color-surface: #1a1e18;
  --mm-color-surface-elevated: #242a22;
  --mm-color-panel: #2c332b;
  --mm-color-foreground: #e8e4d9;
  --mm-color-foreground-muted: #b8b4a8;
  --mm-color-brand: #6b8e5c;
  --mm-color-danger: #c45c4a;
  --mm-color-success: #6b9e6b;
  --mm-color-border: #3a4238;
  --mm-color-border-light: #4f584c;
  --mm-color-tint: #6b8e5c;
  --mm-color-tab-icon: #6b5a45;
  --mm-color-tab-icon-selected: #e8e4d9;
}
`;
