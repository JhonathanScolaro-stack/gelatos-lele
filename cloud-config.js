/* O navegador fala somente com o Worker Cloudflare. A configuração antiga
   abaixo existe apenas para a migração única do aparelho que já tem os dados. */
window.GelatosCloudConfig = Object.freeze({
  apiUrl: 'https://gelatos-lele-sync.scolarojhonathan.workers.dev',
  storeSlug: 'gelatos-lele',
  legacySupabase: {
    url: 'https://gjizibonogbaqymdtito.supabase.co',
    publishableKey: 'sb_publishable_jV6pjMx3oKovqbmPV4xPPQ_ZOAEK8Zw'
  }
});
