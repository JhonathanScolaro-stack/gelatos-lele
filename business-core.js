window.GelatosCore = (() => {
  const round = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
  // Valores financeiros usam centavos. Estoque físico pode precisar de milésimos
  // (por exemplo, 8,437 L ou kg), sem alterar o custo em reais.
  const qty = value => Math.round((Number(value) + Number.EPSILON) * 1000) / 1000;
  const money = value => round(value || 0);
  const total = lines => money(lines.reduce((sum, line) => sum + money(line.total), 0));
  const UNIT = {
    ml: { group: 'volume', factor: 1 }, l: { group: 'volume', factor: 1000 },
    g: { group: 'mass', factor: 1 }, kg: { group: 'mass', factor: 1000 },
    'un.': { group: 'count', factor: 1 }, un: { group: 'count', factor: 1 },
    pacote: { group: 'package', factor: 1 }, caixa: { group: 'package', factor: 1 }, rolo: { group: 'package', factor: 1 }
  };
  const unitKey = unit => String(unit || '').trim().toLocaleLowerCase('pt-BR');
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
    consumed.forEach(line => {
      const available = Number(suppliesById[line.supplyId].quantity);
      if (available < line.quantity) throw new Error('Estoque insuficiente para produzir.');
    });
    return {
      consumed,
      outputQuantity: qty(Number(recipe.yieldUnits) * numberOfBatches),
      totalCost: money(costing.batchCost * numberOfBatches),
      unitCost: costing.unitCost,
    };
  }

  function validateOrder(items, readyById) {
    let cost = 0, revenue = 0;
    const lines = items.map(item => {
      const product = readyById[item.productId];
      const quantity = Number(item.quantity);
      const saleUnitPrice = money(item.saleUnitPrice);
      if (!product || !(quantity > 0) || product.quantity < quantity) throw new Error('Estoque insuficiente no pedido.');
      const line = { ...item, productName: product.name, quantity, saleUnitPrice, unitCost: money(product.unitCost), total: money(quantity * saleUnitPrice), cost: money(quantity * product.unitCost) };
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
  return { money, quantity: qty, receivePurchase, recipeCost, produce, validateOrder, financialSummary, convertQuantity };
})();
