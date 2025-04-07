import type { PropsWithChildren, ReactElement } from 'react'

import { Links, Meta, Outlet, Scripts, ScrollRestoration } from 'react-router'

export function Layout({ children }: PropsWithChildren): ReactElement {
  return (
    <html lang="en">
      <head>
        <meta charSet="UTF-8" />
        <link rel="icon" type="image/svg+xml" href="/nav_logo_hvit.svg" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <link
          rel="preload"
          href="https://cdn.nav.no/aksel/fonts/SourceSans3-normal.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        <title>Nav SMART on FHIR Validator</title>
        <Meta />
        <Links />
      </head>
      <body className="font-['Source_Sans_3','Source_Sans_Pro',Arial,sans-serif]">
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  )
}

export default function Root() {
  return <Outlet />
}
