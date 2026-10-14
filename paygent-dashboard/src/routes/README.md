<!-- paygent-dashboard/src/routes/README.md: convenciones de ruteo por archivos de TanStack Start para esta
     carpeta (nota heredada de Lovable). No describe el dashboard: eso está en paygent-dashboard/README.md.
     Hoy solo existen __root.tsx e index.tsx; la tabla de abajo es la convención general, no rutas reales. -->

# Routes

TanStack Start uses **file-based routing**. Every `.tsx` file in this directory
defines a route. Do **not** create `src/pages/`, `src/routes/_app/index.tsx`, or
`app/layout.tsx` — those are Next.js / Remix conventions. The only root layout
is `src/routes/__root.tsx`.

In this project the only page is `index.tsx` (`/`); tabs and sections are search
params, not routes (see [../../README.md](../../README.md)).

## Conventions

| File | URL |
| --- | --- |
| `index.tsx` | `/` |
| `about.tsx` | `/about` |
| `users/index.tsx` | `/users` |
| `users/$id.tsx` | `/users/:id` (dynamic — bare `$`, no curly braces) |
| `posts/{-$category}.tsx` | `/posts/:category?` (optional segment) |
| `files/$.tsx` | `/files/*` (splat — read via `_splat` param, never `*`) |
| `_layout.tsx` | layout route (renders children via `<Outlet />`) |
| `__root.tsx` | app shell — wraps every page; preserve `<Outlet />` |

`routeTree.gen.ts` is auto-generated. Don't edit it by hand.
