/** Rutas que se abren sin sesión: el login y el menú del comensal (`/m` y todo lo que cuelga de `/m/`). */
export const isPublicPath = (pathname: string) =>
  pathname === "/login" || pathname === "/m" || pathname.startsWith("/m/");
