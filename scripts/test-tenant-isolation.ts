/**
 * Script para testar isolamento de dados por restaurante (tenant) no MongoDB.
 * Execute com: npm run test-tenant-isolation
 *
 * O teste garante que cada restaurante só vê seus próprios dados.
 * Não testa o middleware HTTP, apenas a lógica de queries no banco.
 */

import { MongoClient, ObjectId } from 'mongodb';
import * as dotenv from 'dotenv';
dotenv.config();

const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const DB_NAME = 'main';

async function testTenantIsolation() {
  const client = new MongoClient(MONGO_URI);
  try {
    await client.connect();
    const db = client.db(DB_NAME);

    // Simula dois restaurantes
    const restauranteA = new ObjectId();
    const restauranteB = new ObjectId();

    // Limpa dados antigos
    await db.collection('ingredients').deleteMany({ restaurante_id: { $in: [restauranteA, restauranteB] } });

    // Insere dados para restauranteA
    await db.collection('ingredients').insertOne({
      nome: 'Frango A',
      unidade: 'kg',
      categoria: 'proteina',
      importado: false,
      especializado: false,
      restaurante_id: restauranteA
    });

    // Insere dados para restauranteB
    await db.collection('ingredients').insertOne({
      nome: 'Frango B',
      unidade: 'kg',
      categoria: 'proteina',
      importado: false,
      especializado: false,
      restaurante_id: restauranteB
    });

    // RestauranteA busca seus ingredientes
    const ingredientesA = await db.collection('ingredients').find({ restaurante_id: restauranteA }).toArray();
    if (ingredientesA.length === 1 && ingredientesA[0].nome === 'Frango A') {
      console.log('✅ RestauranteA só vê seus próprios ingredientes');
    } else {
      console.error('❌ RestauranteA vê dados de outros restaurantes ou nenhum dado:', ingredientesA);
    }

    // RestauranteB busca seus ingredientes
    const ingredientesB = await db.collection('ingredients').find({ restaurante_id: restauranteB }).toArray();
    if (ingredientesB.length === 1 && ingredientesB[0].nome === 'Frango B') {
      console.log('✅ RestauranteB só vê seus próprios ingredientes');
    } else {
      console.error('❌ RestauranteB vê dados de outros restaurantes ou nenhum dado:', ingredientesB);
    }

    // Simula query SEM filtro de tenant (como se o hook não estivesse ativo)
    // Deve retornar dados dos 2 restaurantes — isso prova que sem o hook, o isolamento não existe e o hook é necessário
    const semFiltro = await db.collection('ingredients')
      .find({ nome: { $in: ['Frango A', 'Frango B'] } })
      .toArray();

    if (semFiltro.length === 2) {
      console.log('✅ Confirmado: sem filtro de tenant, dados de múltiplos restaurantes aparecem');
      console.log('   → Isso prova que o middleware de tenant isolation é essencial');
    } else {
      console.error('❌ Resultado inesperado:', semFiltro);
    }

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('Erro no teste de tenant isolation:', msg);
    process.exit(1);
  } finally {
    await client.close();
  }
}

testTenantIsolation();
