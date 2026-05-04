/**
 * Script de inicialização dos bancos MongoDB do Mintly.
 * Cria os databases, collections, validações, índices e usuários.
 * Execute com: npm run init-db
 *
 * Requisitos: MongoDB local, permissão de admin/root.
 */


import { MongoClient, Db, TimeSeriesCollectionOptions } from 'mongodb';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
dotenv.config();


const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const MAIN_DB = 'main';
const STG_DB = 'stg';
const BENCHMARK_DB = 'benchmark';
const APP_USER_PWD = process.env.APP_USER_PWD ?? 'app_password123';
const BENCHMARK_USER_PWD = process.env.BENCHMARK_USER_PWD ?? 'benchmark_password123';

// Tipos para os schemas
type JsonSchema = { $jsonSchema: Record<string, unknown> };
type TimeSeriesSchema = { timeseries: TimeSeriesCollectionOptions; validator: JsonSchema };
type CollectionSchema = JsonSchema | TimeSeriesSchema;

function isTimeSeries(schema: CollectionSchema): schema is TimeSeriesSchema {
  return 'timeseries' in schema;
}

// Schemas de validação para cada collection
const schemas: Record<string, CollectionSchema> = {
  restaurants: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['nome', 'cnpj', 'endereco', 'regime_tributario', 'faixa_simples'],
      properties: {
        nome: { bsonType: 'string' },
        cnpj: { bsonType: 'string' },
        endereco: { bsonType: 'string' },
        regime_tributario: { bsonType: 'string', enum: ['MEI', 'ME', 'EPP', 'LTDA', 'SA'] },
        faixa_simples: { bsonType: 'string' },
        certificado_digital: { bsonType: 'string' },
        benchmark_opt_in: { bsonType: 'bool' }
      }
    }
  },
  users: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['email', 'senha_hash', 'role', 'restaurante_id'],
      properties: {
        email: { bsonType: 'string' },
        senha_hash: { bsonType: 'string' },
        role: { bsonType: 'string', enum: ['admin', 'gerente', 'colaborador'] },
        restaurante_id: { bsonType: 'objectId' }
      }
    }
  },
  ingredients: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['nome', 'unidade', 'categoria'],
      properties: {
        nome: { bsonType: 'string' },
        unidade: { bsonType: 'string', enum: ['kg', 'L', 'un'] },
        categoria: { bsonType: 'string', enum: ['proteina', 'hortifruti', 'tempero', 'oleo'] },
        importado: { bsonType: 'bool' },
        especializado: { bsonType: 'bool' },
        restaurante_id: { bsonType: 'objectId' }
      }
    }
  },
  menu_items: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['nome', 'preco_venda', 'categoria', 'ativo', 'restaurante_id'],
      properties: {
        nome: { bsonType: 'string' },
        preco_venda: { bsonType: 'double' },
        categoria: { bsonType: 'string' },
        ativo: { bsonType: 'bool' },
        restaurante_id: { bsonType: 'objectId' }
      }
    }
  },
  recipes: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['menu_item_id', 'ingredientes'],
      properties: {
        menu_item_id: { bsonType: 'objectId' },
        ingredientes: {
          bsonType: 'array',
          items: {
            bsonType: 'object',
            required: ['ingrediente_id', 'quantidade'],
            properties: {
              ingrediente_id: { bsonType: 'objectId' },
              quantidade: { bsonType: 'double' }
            }
          }
        }
      }
    }
  },
  suppliers: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['nome', 'cnpj', 'contato', 'restaurante_id'],
      properties: {
        nome: { bsonType: 'string' },
        cnpj: { bsonType: 'string' },
        contato: { bsonType: 'string' },
        categorias: { bsonType: 'array', items: { bsonType: 'string' } },
        restaurante_id: { bsonType: 'objectId' }
      }
    }
  },
  expenses_fixed: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['tipo', 'valor', 'restaurante_id'],
      properties: {
        tipo: { bsonType: 'string' },
        valor: { bsonType: 'double' },
        restaurante_id: { bsonType: 'objectId' }
      }
    }
  },
  purchases: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['data', 'fornecedor_id', 'itens', 'origem', 'restaurante_id'],
      properties: {
        data: { bsonType: 'date' },
        fornecedor_id: { bsonType: 'objectId' },
        itens: {
          bsonType: 'array',
          items: {
            bsonType: 'object',
            required: ['ingrediente_id', 'quantidade', 'valor'],
            properties: {
              ingrediente_id: { bsonType: 'objectId' },
              quantidade: { bsonType: 'double' },
              valor: { bsonType: 'double' },
              icms: { bsonType: 'double' },
              pis: { bsonType: 'double' },
              cofins: { bsonType: 'double' }
            }
          }
        },
        chave_nfe: { bsonType: 'string' },
        origem: { bsonType: 'string', enum: ['manual', 'mde', 'upload'] },
        xml_path: { bsonType: 'string' },
        restaurante_id: { bsonType: 'objectId' }
      }
    }
  },
  market_prices: {
    timeseries: {
      timeField: 'data',
      metaField: 'fonte',
      granularity: 'hours'
    },
    validator: {
      $jsonSchema: {
        bsonType: 'object',
        required: ['ingrediente', 'preco', 'fonte', 'data', 'regiao'],
        properties: {
          ingrediente: { bsonType: 'string' },
          preco: { bsonType: 'double' },
          fonte: { bsonType: 'string' },
          data: { bsonType: 'date' },
          regiao: { bsonType: 'string' }
        }
      }
    }
  },
  daily_sales: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['data', 'itens', 'faturamento_total', 'restaurante_id'],
      properties: {
        data: { bsonType: 'date' },
        itens: {
          bsonType: 'array',
          items: {
            bsonType: 'object',
            required: ['menu_item_id', 'quantidade'],
            properties: {
              menu_item_id: { bsonType: 'objectId' },
              quantidade: { bsonType: 'int' }
            }
          }
        },
        faturamento_total: { bsonType: 'double' },
        restaurante_id: { bsonType: 'objectId' }
      }
    }
  },
  budgets: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['mes_ano', 'receita_projetada', 'custos', 'impostos', 'margem', 'restaurante_id'],
      properties: {
        mes_ano: { bsonType: 'string' },
        receita_projetada: { bsonType: 'double' },
        custos: { bsonType: 'double' },
        impostos: { bsonType: 'double' },
        margem: { bsonType: 'double' },
        cenarios: { bsonType: 'array', items: { bsonType: 'string' } },
        restaurante_id: { bsonType: 'objectId' }
      }
    }
  },
  menu_analysis: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['data', 'pratos', 'restaurante_id'],
      properties: {
        data: { bsonType: 'date' },
        pratos: {
          bsonType: 'array',
          items: {
            bsonType: 'object',
            required: ['menu_item_id', 'classificacao', 'margem', 'popularidade'],
            properties: {
              menu_item_id: { bsonType: 'objectId' },
              classificacao: { bsonType: 'string' },
              margem: { bsonType: 'double' },
              popularidade: { bsonType: 'double' }
            }
          }
        },
        restaurante_id: { bsonType: 'objectId' }
      }
    }
  },
  purchase_suggestions: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['data', 'sugestoes', 'restaurante_id'],
      properties: {
        data: { bsonType: 'date' },
        sugestoes: {
          bsonType: 'array',
          items: {
            bsonType: 'object',
            required: ['ingrediente_id', 'quantidade'],
            properties: {
              ingrediente_id: { bsonType: 'objectId' },
              quantidade: { bsonType: 'double' }
            }
          }
        },
        restaurante_id: { bsonType: 'objectId' }
      }
    }
  },
  benchmark_contributions: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['mes_ano', 'regiao', 'tipo_cozinha', 'porte', 'dados_agrupados'],
      properties: {
        mes_ano: { bsonType: 'string' },
        regiao: { bsonType: 'string' },
        tipo_cozinha: { bsonType: 'string' },
        porte: { bsonType: 'string' },
        dados_agrupados: {
          bsonType: 'object',
          properties: {
            custo_medio_categoria: { bsonType: 'object' },
            margem_media: { bsonType: 'double' },
            ticket_medio: { bsonType: 'double' }
          }
        }
      }
    }
  }
};

// Índices a serem criados por collection
const indexes: Record<string, { key: Record<string, number>; unique?: boolean }[]> = {
  purchases: [
    { key: { restaurante_id: 1, data: -1 } },
    { key: { fornecedor_id: 1 } }
  ],
  daily_sales: [
    { key: { restaurante_id: 1, data: -1 } }
  ],
  ingredients: [
    { key: { nome: 1, restaurante_id: 1 }, unique: true }
  ],
  menu_items: [
    { key: { restaurante_id: 1, ativo: 1 } }
  ],
  benchmark_contributions: [
    { key: { regiao: 1, tipo_cozinha: 1, mes_ano: 1 } }
  ]
};

// Cria todas as collections e índices para um database (main ou stg)
async function createAppDatabase(db: Db) {
  for (const [name, schema] of Object.entries(schemas)) {
    if (name === 'benchmark_contributions') continue; // só no benchmark

    if (isTimeSeries(schema)) {
      try {
        await db.createCollection(name, {
          timeseries: schema.timeseries,
          validator: schema.validator
        });
        console.log(`[${db.databaseName}] Collection time series criada: ${name}`);
      } catch (e: any) {
        if (e.codeName === 'NamespaceExists') {
          console.log(`[${db.databaseName}] Collection ${name} já existe`);
        } else {
          throw e;
        }
      }
    } else {
      try {
        await db.createCollection(name, { validator: schema });
        console.log(`[${db.databaseName}] Collection criada: ${name}`);
      } catch (e: any) {
        if (e.codeName === 'NamespaceExists') {
          console.log(`[${db.databaseName}] Collection ${name} já existe`);
        } else {
          throw e;
        }
      }
    }

    // Índices
    const collectionIndexes = indexes[name];
    if (collectionIndexes) {
      for (const idx of collectionIndexes) {
        await db.collection(name).createIndex(idx.key, { unique: idx.unique ?? false });
      }
    }
  }
}

// Função principal
async function main() {
  const client = new MongoClient(MONGO_URI);
  try {
    await client.connect();
    console.log('Conectado ao MongoDB');

    // Criação dos databases main e stg
    const mainDb = client.db(MAIN_DB);
    const stgDb = client.db(STG_DB);
    await createAppDatabase(mainDb);
    await createAppDatabase(stgDb);

    // Criação do database benchmark
    const benchmarkDb = client.db(BENCHMARK_DB);
    if (!await benchmarkDb.listCollections({ name: 'benchmark_contributions' }).hasNext()) {
      await benchmarkDb.createCollection('benchmark_contributions', { validator: schemas.benchmark_contributions });
      await benchmarkDb.collection('benchmark_contributions').createIndex({ regiao: 1, tipo_cozinha: 1, mes_ano: 1 });
      console.log('Collection benchmark_contributions criada no benchmark');
    } else {
      console.log('Collection benchmark_contributions já existe no benchmark');
    }

    // Criação dos diretórios de dados brutos
    const dataDirs = [
      path.resolve(__dirname, '../../data/raw/nfe/'),
      path.resolve(__dirname, '../../data/raw/market/')
    ];
    for (const dir of dataDirs) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        console.log(`Diretório criado: ${dir}`);
      }
    }

    // Criação dos usuários MongoDB
    try {
      await mainDb.command({
        createUser: 'app_user',
        pwd: APP_USER_PWD, // Definido via .env ou valor padrão
        roles: [{ role: 'readWrite', db: MAIN_DB }]
      });
      console.log('Usuário app_user criado com sucesso!');
    } catch (e: any) {
      if (e.codeName === 'DuplicateKey') {
        console.log('Usuário app_user já existe');
      } else {
        throw e;
      }
    }

    try {
      await benchmarkDb.command({
        createUser: 'benchmark_user',
        pwd: BENCHMARK_USER_PWD, // Definido via .env ou valor padrão
        roles: [{ role: 'readWrite', db: BENCHMARK_DB }]
      });
      console.log('Usuário benchmark_user criado com sucesso!');
    } catch (e: any) {
      if (e.codeName === 'DuplicateKey') {
        console.log('Usuário benchmark_user já existe');
      } else {
        throw e;
      }
    }

    console.log('Setup concluído.');
  } catch (err) {
    console.error('Erro na inicialização:', err);
    process.exit(1);
  } finally {
    await client.close();
  }
}

main();