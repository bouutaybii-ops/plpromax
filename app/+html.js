import { ScrollViewStyleReset } from 'expo-router/html';

// La page HTML dyal l-web app: icône w plein écran mli kat-zad l l'écran d'accueil (iPhone w Android).
export default function Root({ children }) {
  return (
    <html lang="ar">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <title>PL PRO MAX</title>
        <meta name="theme-color" content="#37003c" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="PL PRO MAX" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <link rel="manifest" href="/manifest.json" />
        <ScrollViewStyleReset />
        <style dangerouslySetInnerHTML={{ __html: 'body{background-color:#37003c;}' }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
