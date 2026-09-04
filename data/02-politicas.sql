-- Blades Privé · paso 1.6 del plan de lanzamiento
-- Correr DESPUÉS de la migración.
--
-- Por qué hace falta: la clave anon va escrita en el código del sitio, a
-- la vista de cualquiera. Sin estas políticas, quien la lea puede borrar
-- el catálogo entero desde la consola del navegador. La contraseña del
-- panel no protege la base de datos: protege una pantalla.
--
-- Después de correr esto, el panel solo puede guardar si Luis tiene
-- sesión iniciada (paso 1.7 y 1.8).

alter table perfumes enable row level security;

-- el catálogo lo puede leer cualquiera que entre al sitio
drop policy if exists "catalogo publico" on perfumes;
create policy "catalogo publico"
  on perfumes for select
  to anon, authenticated
  using (true);

-- escribir, borrar y crear: solo con sesión iniciada
drop policy if exists "solo con sesion se escribe" on perfumes;
create policy "solo con sesion se escribe"
  on perfumes for all
  to authenticated
  using (true) with check (true);

-- Comprobación: esto tiene que devolver rowsecurity = true
select relname, relrowsecurity as rls_activo
from pg_class where relname = 'perfumes';
