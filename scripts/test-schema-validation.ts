/**
 * Script para testar inserções válidas e inválidas contra os schemas do MongoDB.
 * Execute com: npm run test-schema-validation
 */

import { MongoClient, ObjectId } from 'mongodb';
import * as dotenv from 'dotenv';
dotenv.config();

const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const DB_NAME = 'main';

async function testValidInvalid() {
  const client = new MongoClient(MONGO_URI);
  try {
    await client.connect();
    const db = client.db(DB_NAME);
    const restauranteId = new ObjectId();

    // 1. Teste válido: ingrediente
    try {
      await db.collection('ingredients').insertOne({
        nome: 'Teste Válido',
        unidade: 'kg',
        categoria: 'proteina',
        importado: false,
        especializado: false,
        restaurante_id: restauranteId
      });
      console.log('✅ Ingrediente válido inserido com sucesso');
    } catch (err) {
      console.error('❌ Erro ao inserir ingrediente válido:', err);
    }

    // 2. Teste inválido: ingrediente sem campo obrigatório
    try {
      await db.collection('ingredients').insertOne({
        unidade: 'kg',
        categoria: 'proteina',
        importado: false,
        especializado: false,
        restaurante_id: restauranteId
      });
      console.error('❌ ERRO: Ingrediente inválido foi inserido (NÃO era esperado)');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log('✅ Ingrediente inválido rejeitado pelo schema:', msg);
    }

    // 3. Teste inválido: ingrediente com tipo errado
    try {
      await db.collection('ingredients').insertOne({
        nome: 'Teste Tipo Errado',
        unidade: 123, // deveria ser string
        categoria: 'proteina',
        importado: false,
        especializado: false,
        restaurante_id: restauranteId
      });
      console.error('❌ ERRO: Ingrediente com tipo errado foi inserido (NÃO era esperado)');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log('✅ Ingrediente com tipo errado rejeitado pelo schema:', msg);
    }

    // 4. Teste válido: daily_sales
    try {
      await db.collection('daily_sales').insertOne({
        data: new Date(),
        itens: [
          { menu_item_id: new ObjectId(), quantidade: 2 }
        ],
        faturamento_total: 100,
        restaurante_id: restauranteId
      });
      console.log('✅ Venda diária válida inserida com sucesso');
    } catch (err) {
      console.error('❌ Erro ao inserir venda diária válida:', err);
    }

    // 5. Teste inválido: daily_sales sem restaurante_id
    try {
      await db.collection('daily_sales').insertOne({
        data: new Date(),
        itens: [
          { menu_item_id: new ObjectId(), quantidade: 2 }
        ],
        faturamento_total: 100
      });
      console.error('❌ ERRO: Venda diária sem restaurante_id foi inserida (NÃO era esperado)');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log('✅ Venda diária sem restaurante_id rejeitada pelo schema:', msg);
    }

    // 6. Teste inválido: daily_sales com tipo errado
    try {
      await db.collection('daily_sales').insertOne({
        data: '2024-05-04', // deveria ser Date
        itens: [
          { menu_item_id: new ObjectId(), quantidade: 2 }
        ],
        faturamento_total: 100,
        restaurante_id: restauranteId
      });
      console.error('❌ ERRO: Venda diária com data string foi inserida (NÃO era esperado)');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log('✅ Venda diária com data string rejeitada pelo schema:', msg);
    }

    // 7. Teste: purchases sem itens (array vazio)
    try {
      await db.collection('purchases').insertOne({
        data: new Date(),
        fornecedor_id: new ObjectId(),
        itens: [],
        origem: 'manual',
        restaurante_id: restauranteId
      });
      console.log('✅ Compra com array vazio foi aceita (schema não restringe minItems)');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('❌ Compra com array vazio foi rejeitada:', msg);
    }

    // 8. Teste válido: purchases
    try {
      await db.collection('purchases').insertOne({
        data: new Date(),
        fornecedor_id: new ObjectId(),
        itens: [
          { ingrediente_id: new ObjectId(), quantidade: 1, valor: 10 }
        ],
        origem: 'manual',
        restaurante_id: restauranteId
      });
      console.log('✅ Compra válida inserida com sucesso');
    } catch (err) {
      console.error('❌ Erro ao inserir compra válida:', err);
    }

  } finally {
    await client.close();
  }
}

testValidInvalid();
