# Gelatos Lele para Android

Este projeto gera um APK instalável pelo GitHub Actions, sem depender de Android Studio neste computador.

O APK abre a cópia incorporada do sistema e conversa com a mesma nuvem Cloudflare usada pela versão web. A próxima etapa será associar o Firebase Cloud Messaging para receber notificações nativas mesmo com o app fechado.

## Gerar o APK

No GitHub, abra **Actions → Build Gelatos Lele Android APK → Run workflow**. Ao terminar, baixe o artefato **Gelatos-Lele-debug-apk** e instale o arquivo `app-debug.apk` no Android.

O Android poderá pedir autorização para instalar apps deste navegador/gerenciador de arquivos. Isso é esperado para um APK de teste.
