# Familia deCali (Fases 1–5)

## Conta dono
- Usuário: `dono`
- Senha: `decali2024` (ou env `OWNER_PASSWORD`)

## Fase 1 — Convite e login
- Convites com cargo, usos, validade, revogação
- Registro via convite + login
- Minha conta (senha encerra outras sessões)

## Fase 2 — Grupos e chat
- Grupos 2–12, canais de texto
- Digitacao, menções @, apagar mensagem
- Notificação do navegador em menção

## Fase 3 — Mesa e personagem
- Pele, cabelo, roupa, acessório + aleatório
- Mesa com personagens e balões de fala
- Clique no personagem → mencionar / moderar

## Fase 4 — Voz e telas
- Mute, surdez, volume por pessoa
- Push-to-talk (Espaço)
- Até 3 telas simultâneas + qualidade
- Mod: silenciar, parar tela, expulsar

## Fase 5 — Polimento
- PWA (manifest + service worker)
- Página offline
- Reconexão Socket.io
- Log de auditoria + banir usuário
- Sala vazia encerra após ~60s

## Render
Build: `npm install` · Start: `npm start`

Dados em `data/store.json` (efêmero no free tier).
