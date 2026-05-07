# System Architecture (Mermaid)

```mermaid
flowchart LR
  subgraph Cloudflared
    A[api-malika.bpsmalut.com] -->|/backend/*| Admin(Next.js Admin :5050)
    A -->|/*| API(Express API :5000)
    B[malika.bpsmalut.com] -->|/*| PWA(Next.js PWA :3000)
  end

  API --> DB[(MySQL project_data_strategis)]
  API --> Replica[(MySQL data_bps)]
  Admin --> API
  PWA --> API
```
