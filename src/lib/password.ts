export const MIN_PASSWORD = 10;

/** Misma regla que `supabase/config.toml`: mínimo 10 caracteres con letras y números. `null` si es válida. */
export function passwordError(password: string) {
  if (password.length < MIN_PASSWORD || !/[a-zA-Z]/.test(password) || !/\d/.test(password))
    return `Usa al menos ${MIN_PASSWORD} caracteres, con letras y números`;
  return null;
}
