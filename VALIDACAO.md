# Validação realizada

## Plugin

- compilado com Java 21;
- JAR validado com `unzip -t`;
- linkage das novas classes validado com `java -Xverify:all`;
- teste local real do cliente HMAC/lote contra um HTTP server executado com resultado:

```text
API_HAS_PUBLIC=true
HMAC_AND_BATCH_OK=true
```

- no teste, o arquivo durável foi removido da fila somente depois do HTTP 202.

## Backend

Os arquivos JavaScript do backend foram validados com `node --check` usando Node 22.

## Frontend

Projeto React/Vite e Dockerfile foram montados para build no Docker. As dependências não foram baixadas neste ambiente; o `docker build` na VPS/Coolify executa `npm install` e `npm run build`.

## Teste que ainda depende do servidor real

O plugin precisa ser validado no Paper 26.2 real para confirmar os hooks de todos os plugins instalados e o volume de console do ambiente HEZZUZ. A troca deve ser feita com restart completo, nunca via PlugMan.
