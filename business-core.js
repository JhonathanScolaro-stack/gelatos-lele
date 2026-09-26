window.GelatosCore = (() => {
  const round = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
  // Valores financeiros usam centavos. Estoque físico pode precisar de milésimos
  // (por exemplo, 8,437 L ou kg), sem alterar o custo em reais.
  const qty = value => Math.round((Number(value) + Number.EPSILON) * 1000) / 1000;
  const money = value => round(value || 0);
  const total = lines => money(lines.reduce((sum, line) => sum + money(line.total), 0));
  // Cada medida tem uma forma canônica. As variações comuns digitadas no
  // celular são aceitas, mas pacote, caixa e rolo NÃO são equivalentes: uma
  // caixa pode conter uma quantidade completamente diferente de um pacote.
  const UNIT = {
    ml: { group: 'volume', factor: 1 }, mililitro: { group: 'volume', factor: 1 }, mililitros: { group: 'volume', factor: 1 },
    l: { group: 'volume', factor: 1000 }, litro: { group: 'volume', factor: 1000 }, litros: { group: 'volume', factor: 1000 },
    g: { group: 'mass', factor: 1 }, grama: { group: 'mass', factor: 1 }, gramas: { group: 'mass', factor: 1 },
    kg: { group: 'mass', factor: 1000 }, quilo: { group: 'mass', factor: 1000 }, quilos: { group: 'mass', factor: 1000 },
    un: { group: 'count', factor: 1 }, unidade: { group: 'count', factor: 1 }, unidades: { group: 'count', factor: 1 }, und: { group: 'count', factor: 1 }, unds: { group: 'count', factor: 1 },
    pacote: { group: 'package:pacote', factor: 1 }, pacotes: { group: 'package:pacote', factor: 1 },
    caixa: { group: 'package:caixa', factor: 1 }, caixas: { group: 'package:caixa', factor: 1 }, cx: { group: 'package:caixa', factor: 1 },
    rolo: { group: 'package:rolo', factor: 1 }, rolos: { group: 'package:rolo', factor: 1 }
  };
  const unitKey = unit => String(unit || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleLowerCase('pt-BR').replace(/[.\s]+/g, '');
  function convertQuantity(quantity, fromUnit, toUnit) {
    const from = UNIT[unitKey(fromUnit)];
    const to = UNIT[unitKey(toUnit)];
    if (!from || !to || from.group !== to.group) {
      if (unitKey(fromUnit) === unitKey(toUnit)) return Number(quantity);
      throw new Error('Unidades incompatíveis na receita: use ' + (toUnit || 'a unidade cadastrada no estoque') + '.');
    }
    return qty(Number(quantity) * from.factor / to.factor);
  }

  function receivePurchase(stock, purchase) {
    const purchasedQuantity = Number(purchase.quantity);
    const paid = money(purchase.totalPaid);
    if (!(purchasedQuantity > 0) || !(paid >= 0)) throw new Error('Compra inválida.');
    const oldQty = Number(stock.quantity || 0);
    const oldAverage = money(stock.averageUnitCost || 0);
    return {
      ...stock,
      quantity: qty(oldQty + purchasedQuantity),
      averageUnitCost: money((oldQty * oldAverage + paid) / (oldQty + purchasedQuantity)),
      lastPurchaseAt: purchase.date,
      lastPurchaseTotal: paid,
    };
  }

  function recipeCost(recipe, suppliesById) {
    const lines = recipe.items.map(item => {
      const supply = suppliesById[item.supplyId];
      if (!supply) throw new Error('Insumo da receita não encontrado.');
      const recipeQuantity = Number(item.quantity);
      if (!(recipeQuantity > 0)) throw new Error('Quantidade de receita inválida.');
      const quantity = convertQuantity(recipeQuantity, item.unit || supply.unit, supply.unit);
      return {
        ...item,
        recipeQuantity,
        quantity,
        unitCost: money(supply.averageUnitCost),
        total: money(quantity * supply.averageUnitCost),
      };
    });
    const batchCost = total(lines);
    const yieldUnits = Number(recipe.yieldUnits);
    if (!(yieldUnits > 0)) throw new Error('Rendimento inválido.');
    return { lines, batchCost, unitCost: money(batchCost / yieldUnits) };
  }

  function produce(recipe, batches, suppliesById) {
    const numberOfBatches = Number(batches);
    if (!(numberOfBatches > 0)) throw new Error('Quantidade de lotes inválida.');
    const costing = recipeCost(recipe, suppliesById);
    const consumed = Object.values(costing.lines.reduce((grouped, line) => {
      const supplyId = line.supplyId;
      const previous = grouped[supplyId] || { supplyId, quantity: 0, cost: 0 };
      previous.quantity = qty(previous.quantity + line.quantity * numberOfBatches);
      previous.cost = money(previous.cost + line.total * numberOfBatches);
      grouped[supplyId] = previous;
      return grouped;
    }, {}));
    const shortages = [];
    consumed.forEach(line => {
      const available = Number(suppliesById[line.supplyId].quantity);
      line.available = qty(available);
      line.name = String(suppliesById[line.supplyId].name || 'Item');
      line.unit = String(suppliesById[line.supplyId].unit || 'un.');
      if (available + 0.0000001 < line.quantity) shortages.push({ ...line, missing: qty(line.quantity - available) });
    });
    if (shortages.length) {
      const detail = shortages.map(line => line.name + ': precisa ' + line.quantity + ' ' + line.unit + ', disponível ' + line.available + ' ' + line.unit + ', faltam ' + line.missing + ' ' + line.unit).join(' · ');
      const error = new Error('Estoque insuficiente para produzir. ' + detail);
      error.code = 'ESTOQUE_INSUFICIENTE';
      error.shortages = shortages;
      throw error;
    }
    return {
      consumed,
      outputQuantity: qty(Number(recipe.yieldUnits) * numberOfBatches),
      totalCost: money(costing.batchCost * numberOfBatches),
      unitCost: costing.unitCost,
    };
  }

  function productionCapacity(recipe, suppliesById) {
    const costing = recipeCost(recipe, suppliesById);
    const requirements = Object.values(costing.lines.reduce((grouped, line) => {
      const previous = grouped[line.supplyId] || { supplyId: line.supplyId, quantity: 0 };
      previous.quantity = qty(previous.quantity + line.quantity);
      grouped[line.supplyId] = previous;
      return grouped;
    }, {})).map(line => {
      const supply = suppliesById[line.supplyId];
      const available = qty(Number(supply.quantity || 0));
      const batches = line.quantity > 0 ? Math.max(0, Math.floor((available + 0.0000001) / line.quantity)) : 0;
      return { ...line, available, batches, name: String(supply.name || 'Item'), unit: String(supply.unit || 'un.') };
    });
    const maxBatches = requirements.length ? Math.max(0, Math.min(...requirements.map(line => line.batches))) : 0;
    return { maxBatches, requirements, outputQuantity: qty(maxBatches * Number(recipe.yieldUnits || 0)) };
  }

  function validateOrder(items, readyById) {
    let cost = 0, revenue = 0;
    const lines = items.map(item => {
      const product = readyById[item.productId];
      const quantity = Number(item.quantity);
      const saleUnitPrice = money(item.saleUnitPrice);
      if (!product || !(quantity > 0) || product.quantity < quantity) throw new Error('Estoque insuficiente no pedido.');
      const grossTotal = money(quantity * saleUnitPrice);
      // O desconto pertence ao sabor, nunca ao pedido inteiro. Limitá-lo ao
      // valor da própria linha evita total negativo por erro de digitação.
      const requestedDiscount = Number(item.discountTotal ?? (Number(item.discountPerUnit || 0) * quantity));
      const discountTotal = money(Math.max(0, Math.min(grossTotal, Number.isFinite(requestedDiscount) ? requestedDiscount : 0)));
      const line = { ...item, productName: product.name, quantity, saleUnitPrice, grossTotal, discountTotal, discountPerUnit: quantity > 0 ? money(discountTotal / quantity) : 0, unitCost: money(product.unitCost), total: money(grossTotal - discountTotal), cost: money(quantity * product.unitCost) };
      cost += line.cost; revenue += line.total;
      return line;
    });
    return { lines, revenue: money(revenue), cost: money(cost), profit: money(revenue - cost) };
  }

  function financialSummary(orders, expenses) {
    const paid = orders.filter(order => order.status === 'paid');
    const revenue = total(paid.map(order => ({ total: order.total })));
    const cost = total(paid.map(order => ({ total: order.cost })));
    const paymentFees = total(paid.map(order => ({ total: order.paymentFee })));
    const deliveryCosts = total(paid.map(order => ({ total: order.deliveryCost })));
    const activeExpenses = expenses.filter(expense => !expense.voided);
    const expenseTotal = total(activeExpenses.map(expense => ({ total: expense.total })));
    const stockPurchases = total(activeExpenses.filter(expense => expense.category === 'purchase').map(expense => ({ total: expense.total })));
    const operationalExpense = total(activeExpenses.filter(expense => expense.category !== 'purchase').map(expense => ({ total: expense.total })));
    const methods = ['Dinheiro', 'Pix', 'Crédito', 'Débito'].reduce((result, method) => {
      result[method] = money(
        total(paid.filter(order => order.paymentMethod === method).map(order => ({ total: money(order.total) - money(order.paymentFee) }))) -
        total(activeExpenses.filter(expense => expense.paymentMethod === method).map(expense => ({ total: expense.total })))
      );
      return result;
    }, {});
    return {
      revenue, cost, paymentFees, deliveryCosts, expenseTotal, stockPurchases, operationalExpense,
      profit: money(revenue - cost - paymentFees - deliveryCosts - operationalExpense), methods
    };
  }
  return { money, quantity: qty, receivePurchase, recipeCost, produce, productionCapacity, validateOrder, financialSummary, convertQuantity };
})();
