/**
 * Script de seed para dados de demonstração do restaurante de frango frito coreano.
 * Execute com: npm run seed-demo
 *
 * Requisitos: MongoDB local, permissão de escrita no banco 'app'.
 *
 * O restaurante de teste terá:
 * - Ingredientes típicos
 * - Pratos do cardápio
 * - Fornecedores fictícios
 * - Usuário admin
 * - Dados de vendas, receitas, despesas, etc (mínimo para testes)
 */

import { MongoClient, ObjectId } from 'mongodb';
import * as dotenv from 'dotenv';
import * as crypto from 'crypto';
dotenv.config();

const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const DB_NAME = 'main';

// Dados fixos do restaurante demo
const restauranteId = new ObjectId();
const userId = new ObjectId();
const fornecedorId = new ObjectId();
const menuItemId = new ObjectId();
const ingredienteFrangoId = new ObjectId();
const ingredienteFarinhaId = new ObjectId();
const ingredienteOleoId = new ObjectId();
const ingredienteAlhoId = new ObjectId();
const ingredienteGengibreId = new ObjectId();

// Hash de senha demo (NUNCA use em produção)
const senhaHash = crypto.createHash('sha256').update('admin123').digest('hex');

async function main() {
  const client = new MongoClient(MONGO_URI);
  try {
    await client.connect();
    const db = client.db(DB_NAME);

    // Limpa dados antigos do restaurante demo (opcional)
    await Promise.all([
      db.collection('restaurants').deleteMany({ _id: restauranteId }),
      db.collection('users').deleteMany({ restaurante_id: restauranteId }),
      db.collection('ingredients').deleteMany({ restaurante_id: restauranteId }),
      db.collection('menu_items').deleteMany({ restaurante_id: restauranteId }),
      db.collection('suppliers').deleteMany({ restaurante_id: restauranteId }),
      db.collection('recipes').deleteMany({ menu_item_id: menuItemId }),
      db.collection('expenses_fixed').deleteMany({ restaurante_id: restauranteId }),
      db.collection('daily_sales').deleteMany({ restaurante_id: restauranteId }),
      db.collection('budgets').deleteMany({ restaurante_id: restauranteId }),
      db.collection('menu_analysis').deleteMany({ restaurante_id: restauranteId }),
      db.collection('purchase_suggestions').deleteMany({ restaurante_id: restauranteId }),
      db.collection('purchases').deleteMany({ restaurante_id: restauranteId })
    ]);

    // 1. Restaurante
    await db.collection('restaurants').insertOne({
      _id: restauranteId,
      nome: 'K-Fry Chicken Demo',
      cnpj: '12.345.678/0001-99',
      endereco: 'Rua Coreia, 100, São Paulo',
      regime_tributario: 'ME',
      faixa_simples: '2',
      certificado_digital: '',
      benchmark_opt_in: true
    });

    // 2. Usuário admin
    await db.collection('users').insertOne({
      _id: userId,
      email: 'admin@kfry.com',
      senha_hash: senhaHash, // Em produção, use hash seguro!
      role: 'admin',
      restaurante_id: restauranteId
    });

    // 3. Ingredientes
    await db.collection('ingredients').insertMany([
      {
        _id: ingredienteFrangoId,
        nome: 'Frango',
        unidade: 'kg',
        categoria: 'proteina',
        importado: false,
        especializado: false,
        restaurante_id: restauranteId
      },
      {
        _id: ingredienteFarinhaId,
        nome: 'Farinha de trigo',
        unidade: 'kg',
        categoria: 'hortifruti',
        importado: false,
        especializado: false,
        restaurante_id: restauranteId
      },
      {
        _id: ingredienteOleoId,
        nome: 'Óleo de soja',
        unidade: 'L',
        categoria: 'oleo',
        importado: false,
        especializado: false,
        restaurante_id: restauranteId
      },
      {
        _id: ingredienteAlhoId,
        nome: 'Alho',
        unidade: 'kg',
        categoria: 'tempero',
        importado: false,
        especializado: false,
        restaurante_id: restauranteId
      },
      {
        _id: ingredienteGengibreId,
        nome: 'Gengibre',
        unidade: 'kg',
        categoria: 'tempero',
        importado: false,
        especializado: false,
        restaurante_id: restauranteId
      }
    ]);

    // 4. Fornecedor
    await db.collection('suppliers').insertOne({
      _id: fornecedorId,
      nome: 'Fornecedor Demo',
      cnpj: '98.765.432/0001-11',
      contato: 'fornecedor@demo.com',
      categorias: ['proteina', 'hortifruti', 'tempero', 'oleo'],
      restaurante_id: restauranteId
    });

    // 5. Prato do cardápio
    await db.collection('menu_items').insertOne({
      _id: menuItemId,
      nome: 'Frango Frito Coreano',
      preco_venda: 49.9,
      categoria: 'prato principal',
      ativo: true,
      restaurante_id: restauranteId
    });

    // 6. Receita (ficha técnica)
    await db.collection('recipes').insertOne({
      menu_item_id: menuItemId,
      ingredientes: [
        { ingrediente_id: ingredienteFrangoId, quantidade: 0.25 },
        { ingrediente_id: ingredienteFarinhaId, quantidade: 0.05 },
        { ingrediente_id: ingredienteOleoId, quantidade: 0.1 },
        { ingrediente_id: ingredienteAlhoId, quantidade: 0.01 },
        { ingrediente_id: ingredienteGengibreId, quantidade: 0.01 }
      ]
    });

    // 7. Despesa fixa
    await db.collection('expenses_fixed').insertOne({
      tipo: 'Aluguel',
      valor: 3000,
      restaurante_id: restauranteId
    });

    // 8. Venda diária
    await db.collection('daily_sales').insertOne({
      data: new Date(),
      itens: [
        { menu_item_id: menuItemId, quantidade: 10 }
      ],
      faturamento_total: 499,
      restaurante_id: restauranteId
    });

    // 9. Compra
    await db.collection('purchases').insertOne({
      data: new Date(),
      fornecedor_id: fornecedorId,
      itens: [
        { ingrediente_id: ingredienteFrangoId, quantidade: 2.5, valor: 60 },
        { ingrediente_id: ingredienteOleoId, quantidade: 1, valor: 8 }
      ],
      chave_nfe: 'NFE123456789',
      origem: 'manual',
      xml_path: '/data/raw/nfe/demo/2024-05/nfe123.xml',
      restaurante_id: restauranteId
    });

    // 10. Orçamento
    await db.collection('budgets').insertOne({
      mes_ano: '2024-05',
      receita_projetada: 10000,
      custos: 7000,
      impostos: 1200,
      margem: 1800,
      cenarios: ['otimista', 'realista', 'pessimista'],
      restaurante_id: restauranteId
    });

    // 11. Menu analysis
    await db.collection('menu_analysis').insertOne({
      data: new Date(),
      pratos: [
        { menu_item_id: menuItemId, classificacao: 'estrela', margem: 25, popularidade: 10 }
      ],
      restaurante_id: restauranteId
    });

    // 12. Sugestão de compra
    await db.collection('purchase_suggestions').insertOne({
      data: new Date(),
      sugestoes: [
        { ingrediente_id: ingredienteFrangoId, quantidade: 5 }
      ],
      restaurante_id: restauranteId
    });

    console.log('Seed de demonstração inserido com sucesso!');
  } catch (err) {
    console.error('Erro ao rodar seed:', err);
    process.exit(1);
  } finally {
    await client.close();
  }
}

main();