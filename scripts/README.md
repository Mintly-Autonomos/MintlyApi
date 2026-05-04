# Documentação dos Scripts e Schemas do MongoDB


## 1. Estrutura dos bancos de dados

O Mintly utiliza 3 bancos MongoDB:

- **main**: banco principal de produção
- **stg**: banco de homologação/staging (estrutura idêntica ao main)
- **benchmark**: banco para dados anonimizados de benchmark

Todos os scripts usam por padrão o banco main, exceto quando indicado.

---

## 2. Como rodar cada script

Todos os scripts devem ser executados a partir da raiz do projeto MintlyApi, com as variáveis de ambiente configuradas (veja `.env.example`).

### Inicializar bancos, schemas e índices
```
npm run init-db
```
Cria os bancos main, stg e benchmark, com todas as collections, schemas, índices e usuários necessários.

### Popular dados de demonstração
```
npm run seed-demo
```
Insere dados de exemplo no banco main para um restaurante fictício.

### Testar validação dos schemas
```
npm run test-schema-validation
```
Testa inserções válidas e inválidas no banco main para garantir que os schemas estão corretos.

### Testar isolamento de tenants
```
npm run test-tenant-isolation
```
Simula dois restaurantes no banco main e garante que cada um só vê seus próprios dados.

---

## 2. Documentação das Collections

### ingredients
- **Campos:**
  - `nome` (string, obrigatório)
  - `unidade` (string, obrigatório)
  - `categoria` (string, obrigatório)
  - `importado` (boolean, obrigatório)
  - `especializado` (boolean, obrigatório)
  - `restaurante_id` (ObjectId, obrigatório)
- **Exemplo:**
```json
{
  "nome": "Frango",
  "unidade": "kg",
  "categoria": "proteina",
  "importado": false,
  "especializado": false,
  "restaurante_id": "ObjectId(\"...\")"
}
```

### menu_items
- **Campos:**
  - `nome` (string, obrigatório)
  - `preco_venda` (double, obrigatório)
  - `categoria` (string, obrigatório)
  - `ativo` (boolean, obrigatório)
  - `restaurante_id` (ObjectId, obrigatório)
- **Exemplo:**
```json
{
  "nome": "Frango Frito",
  "preco_venda": 39.9,
  "categoria": "prato principal",
  "ativo": true,
  "restaurante_id": "ObjectId(\"...\")"
}
```

### users
- **Campos:**
  - `email` (string, obrigatório)
  - `senha_hash` (string, obrigatório)
  - `role` (string, obrigatório, enum: ["admin", "gerente", "colaborador"])
  - `restaurante_id` (ObjectId, obrigatório)
- **Exemplo:**
```json
{
  "email": "joao@exemplo.com",
  "senha_hash": "$2b$10$...",
  "role": "admin",
  "restaurante_id": "ObjectId(\"...\")"
}
```


### restaurants
- **Campos:**
  - `nome` (string, obrigatório)
  - `cnpj` (string, obrigatório)
  - `endereco` (string, obrigatório)
  - `regime_tributario` (string, obrigatório, enum: ["MEI", "ME", "EPP", "LTDA", "SA"])
  - `faixa_simples` (string, obrigatório)
  - `certificado_digital` (string, opcional)
  - `benchmark_opt_in` (boolean, opcional)
- **Exemplo:**
```json
{
  "nome": "Restaurante Exemplo",
  "cnpj": "12345678000199",
  "endereco": "Rua Exemplo, 123",
  "regime_tributario": "ME",
  "faixa_simples": "Faixa 1",
  "certificado_digital": "...",
  "benchmark_opt_in": true
}
```

### suppliers
- **Campos:**
  - `nome` (string, obrigatório)
  - `cnpj` (string, obrigatório)
  - `contato` (string, obrigatório)
  - `categorias` (array de string, opcional)
  - `restaurante_id` (ObjectId, obrigatório)
- **Exemplo:**
```json
{
  "nome": "Fornecedor Exemplo",
  "cnpj": "12345678000199",
  "contato": "(11) 99999-9999",
  "categorias": ["proteina", "hortifruti"],
  "restaurante_id": "ObjectId(\"...\")"
}
```

### recipes
- **Campos:**
  - `menu_item_id` (ObjectId, obrigatório)
  - `ingredientes` (array de objetos, obrigatório)
    - cada item: `{ ingrediente_id: ObjectId, quantidade: double }`
- **Exemplo:**
```json
{
  "menu_item_id": "ObjectId(\"...\")",
  "ingredientes": [
    { "ingrediente_id": "ObjectId(\"...\")", "quantidade": 1.5 }
  ]
}
```

### expenses_fixed
- **Campos:**
  - `tipo` (string, obrigatório)
  - `valor` (double, obrigatório)
  - `restaurante_id` (ObjectId, obrigatório)
- **Exemplo:**
```json
{
  "tipo": "Aluguel",
  "valor": 2500.0,
  "restaurante_id": "ObjectId(\"...\")"
}
```

### purchases
- **Campos:**
  - `data` (date, obrigatório)
  - `fornecedor_id` (ObjectId, obrigatório)
  - `itens` (array de objetos, obrigatório)
    - cada item: `{ ingrediente_id: ObjectId, quantidade: double, valor: double, icms?: double, pis?: double, cofins?: double }`
  - `chave_nfe` (string, opcional)
  - `origem` (string, obrigatório, enum: ["manual", "mde", "upload"])
  - `xml_path` (string, opcional)
  - `restaurante_id` (ObjectId, obrigatório)
- **Exemplo:**
```json
{
  "data": "2024-05-04T12:00:00.000Z",
  "fornecedor_id": "ObjectId(\"...\")",
  "itens": [
    { "ingrediente_id": "ObjectId(\"...\")", "quantidade": 10, "valor": 100.0 }
  ],
  "chave_nfe": "NFe123",
  "origem": "manual",
  "xml_path": "/caminho/para/xml",
  "restaurante_id": "ObjectId(\"...\")"
}
```

### daily_sales
- **Campos:**
  - `data` (date, obrigatório)
  - `itens` (array de objetos, obrigatório)
    - cada item: `{ menu_item_id: ObjectId, quantidade: int }`
  - `faturamento_total` (double, obrigatório)
  - `restaurante_id` (ObjectId, obrigatório)
- **Exemplo:**
```json
{
  "data": "2024-05-04T12:00:00.000Z",
  "itens": [
    { "menu_item_id": "ObjectId(\"...\")", "quantidade": 20 }
  ],
  "faturamento_total": 798.0,
  "restaurante_id": "ObjectId(\"...\")"
}
```

### budgets
- **Campos:**
  - `mes_ano` (string, obrigatório)
  - `receita_projetada` (double, obrigatório)
  - `custos` (double, obrigatório)
  - `impostos` (double, obrigatório)
  - `margem` (double, obrigatório)
  - `cenarios` (array de string, opcional)
  - `restaurante_id` (ObjectId, obrigatório)
- **Exemplo:**
```json
{
  "mes_ano": "2024-05",
  "receita_projetada": 10000.0,
  "custos": 7000.0,
  "impostos": 1000.0,
  "margem": 2000.0,
  "cenarios": ["otimista", "pessimista"],
  "restaurante_id": "ObjectId(\"...\")"
}
```

### menu_analysis
- **Campos:**
  - `data` (date, obrigatório)
  - `pratos` (array de objetos, obrigatório)
    - cada item: `{ menu_item_id: ObjectId, classificacao: string, margem: double, popularidade: double }`
  - `restaurante_id` (ObjectId, obrigatório)
- **Exemplo:**
```json
{
  "data": "2024-05-04T12:00:00.000Z",
  "pratos": [
    { "menu_item_id": "ObjectId(\"...\")", "classificacao": "estrela", "margem": 30.0, "popularidade": 80.0 }
  ],
  "restaurante_id": "ObjectId(\"...\")"
}
```

### purchase_suggestions
- **Campos:**
  - `data` (date, obrigatório)
  - `sugestoes` (array de objetos, obrigatório)
    - cada item: `{ ingrediente_id: ObjectId, quantidade: double }`
  - `restaurante_id` (ObjectId, obrigatório)
- **Exemplo:**
```json
{
  "data": "2024-05-04T12:00:00.000Z",
  "sugestoes": [
    { "ingrediente_id": "ObjectId(\"...\")", "quantidade": 5.0 }
  ],
  "restaurante_id": "ObjectId(\"...\")"
}
```

### benchmark_contributions
- **Campos:**
  - `mes_ano` (string, obrigatório)
  - `regiao` (string, obrigatório)
  - `tipo_cozinha` (string, obrigatório)
  - `porte` (string, obrigatório)
  - `dados_agrupados` (object, obrigatório)
    - campos possíveis: `custo_medio_categoria` (object), `margem_media` (double), `ticket_medio` (double)
- **Exemplo:**
```json
{
  "mes_ano": "2024-05",
  "regiao": "SP",
  "tipo_cozinha": "coreana",
  "porte": "médio",
  "dados_agrupados": {
    "custo_medio_categoria": { "proteina": 20.0 },
    "margem_media": 25.0,
    "ticket_medio": 50.0
  }
}
```

---

## 3. Tenant Isolation (Isolamento de Dados por Restaurante)

### O que é?
Tenant isolation garante que cada restaurante (tenant) só acesse seus próprios dados, mesmo que todos estejam no mesmo banco.

### Como funciona?
- Cada documento tem o campo `restaurante_id`.
- Todas as queries do backend filtram por esse campo.
- Um middleware (hook) no Fastify insere automaticamente o filtro `restaurante_id` nas queries, usando o restaurante do usuário autenticado.

### O que muda com JWT?
- Atualmente, o restaurante é identificado por header manual.
- Com JWT, o backend extrai o restaurante do token JWT, tornando o processo mais seguro e transparente.
- O middleware será atualizado para ler o restaurante do JWT em vez do header.

---

Dúvidas? Consulte os scripts ou abra uma issue.
