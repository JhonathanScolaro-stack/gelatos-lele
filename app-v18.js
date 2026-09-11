(() => {
  'use strict';

  const STORE = 'gelatos-lele-company-v11';
  const OLD_STORE = 'gelatos-lele-company-v10';
  const LAST_SCREEN_KEY = STORE + '-last-screen-v1';
  const METHODS = ['Dinheiro', 'Pix', 'Crédito', 'Débito'];
  const $ = (selector, root = document) => root.querySelector(selector);
  const control = (form, name) => form.elements.namedItem(name);
  const moneyFormat = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  const today = () => new Date().toISOString().slice(0, 10);
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
  const n = value => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    let text = String(value ?? '').trim().replace(/\s/g, '');
    if (text.includes(',') && text.includes('.')) text = text.replace(/\./g, '').replace(',', '.');
    else text = text.replace(',', '.');
    const result = Number(text.replace(/[^0-9.-]/g, ''));
    return Number.isFinite(result) ? result : 0;
  };
  const round = value => Math.round((n(value) + Number.EPSILON) * 100) / 100;
  const money = value => moneyFormat.format(n(value));
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
  const brDate = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? String(value).slice(8, 10) + '/' + String(value).slice(5, 7) + '/' + String(value).slice(0, 4) : '—';
  const empty = text => '<p class="list-empty">' + esc(text) + '</p>';
  const day = value => String(value || '').slice(0, 10);
  const byId = (list, key = 'id') => Object.fromEntries(list.map(item => [String(item[key]), item]));

  const DEFAULT_SETTINGS = {
    pixKey: '',
    homeLogoDataUrl: '',
    headerLogoDataUrl: '',
    whatsappTemplate: 'Olá, {nome}!\n\nSeu pedido Gelatos Lele foi confirmado!\n\n{itens}\n\nValor total: {total}\n\nChave Pix: {pix}',
    catalogIntro: 'Geladinhos artesanais preparados com carinho. Confira os sabores disponíveis e faça seu pedido.',
    catalogPhone: '',
    businessAddress: '',
    pickupAddress: '',
    deliveryModes: 'Retirada,Entrega',
    deliveryZones: '',
    freeDeliveryMinValue: '',
    freeDeliveryMinItems: ''
  };
  const blankData = () => ({
    version: 18,
    supplies: [], recipes: [], productions: [], readyStock: [], orders: [], expenses: [],
    suppliers: [], purchases: [], notifications: [], notificationKeys: [], settings: { ...DEFAULT_SETTINGS }
  });
  function normalize(raw) {
    const old = raw && typeof raw === 'object' ? raw : {};
    const settings = old.settings || {};
    return {
      ...blankData(), ...old,
      supplies: Array.isArray(old.supplies) ? old.supplies.map(item => ({
        ...item,
        category: item.category === 'supply' ? 'supply' : 'ingredient',
        quantity: Math.max(0, n(item.quantity)),
        averageUnitCost: Math.max(0, n(item.averageUnitCost)),
        minimumStock: Math.max(0, n(item.minimumStock)),
        unit: item.unit || 'un.',
        movements: Array.isArray(item.movements) ? item.movements : []
      })) : [],
      recipes: Array.isArray(old.recipes) ? old.recipes.map(item => ({
        ...item,
        active: item.active !== false,
        description: item.description || '',
        preparation: item.preparation || '',
        laborAmount: Math.max(0, n(item.laborAmount)),
        laborMode: item.laborMode === 'unit' ? 'unit' : 'batch',
        items: Array.isArray(item.items) ? item.items : []
      })) : [],
      productions: Array.isArray(old.productions) ? old.productions : [],
      readyStock: Array.isArray(old.readyStock) ? old.readyStock.map(item => ({
        ...item,
        quantity: Math.max(0, n(item.quantity)),
        unitCost: Math.max(0, n(item.unitCost)),
        saleUnitPrice: Math.max(0, n(item.saleUnitPrice)),
        minimumStock: Math.max(0, n(item.minimumStock)),
        movements: Array.isArray(item.movements) ? item.movements : []
      })) : [],
      orders: Array.isArray(old.orders) ? old.orders.map(item => ({
        ...item,
        items: Array.isArray(item.items) ? item.items : [],
        date: item.date || today(),
        dueDate: item.dueDate || item.date || today(),
        paidAt: item.paidAt || '',
        status: item.status || 'confirmed'
      })) : [],
      expenses: Array.isArray(old.expenses) ? old.expenses : [],
      suppliers: Array.isArray(old.suppliers) ? old.suppliers : [],
      purchases: Array.isArray(old.purchases) ? old.purchases : [],
      notifications: Array.isArray(old.notifications) ? old.notifications : [],
      notificationKeys: Array.isArray(old.notificationKeys) ? old.notificationKeys : [],
      settings: {
        ...DEFAULT_SETTINGS, ...settings,
        homeLogoDataUrl: settings.homeLogoDataUrl || settings.logoDataUrl || '',
        headerLogoDataUrl: settings.headerLogoDataUrl || settings.logoDataUrl || ''
      }
    };
  }
  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORE) || 'null') || JSON.parse(localStorage.getItem(OLD_STORE) || 'null');
      return normalize(raw);
    } catch (_) {
      return blankData();
    }
  }

  function resumableScreen(value) {
    const fallback = {
      'order-edit': 'orders-history',
      'supply-edit': 'stock-ingredient',
      'ready-edit': 'stock-ready',
      'stock-ready-manual': 'stock-ready',
      'production-edit': 'production',
      'supplier-edit': 'records-suppliers'
    };
    const screen = fallback[String(value || '')] || String(value || '');
    return /^(home|orders-(new|history)|stock-(purchase|ingredient|supply|ready)|recipes|production|finance-(overview|receivable|payable)|reports-(orders|finance|stock)|records-(catalog|suppliers)|tools-(compare|capacity)|settings-(home|cloud|appearance|message|catalog|delivery|backup))$/.test(screen) ? screen : 'home';
  }
  function loadLastScreen() {
    try { return resumableScreen(localStorage.getItem(LAST_SCREEN_KEY)); }
    catch (_) { return 'home'; }
  }
  function rememberScreen() {
    try { localStorage.setItem(LAST_SCREEN_KEY, resumableScreen(state.screen)); }
    catch (_) { /* O app continua funcional se o navegador bloquear armazenamento. */ }
  }

  let data = load();
  let cloudRevision = null;
  let cloudSyncTimer = null;
  let cloudSaving = false;
  let cloudPolling = false;
  let orderSubmitting = false;
  let deferredInstall = null;
  const state = {
    screen: loadLastScreen(),
    menu: '',
    notices: false,
    info: null,
    orderLines: [{ productId: '', quantity: 1 }],
    orderDraft: null,
    recipeLines: [{ supplyId: '', quantity: '', unit: '' }],
    recipeDraft: null,
    editOrder: '',
    editSupply: '',
    editReady: '',
    editProduction: '',
    editSupplier: '',
    editExpense: '',
    reportFilter: { start: '', end: '', min: '', max: '', query: '', payment: '', status: '' },
    reportRanking: ''
  };
  // Cada endereço (Netlify, GitHub Pages etc.) possui seu próprio armazenamento do navegador.
  // Ao abrir o app em um endereço novo, encaminhe para a entrada em vez de exibir um painel vazio.
  if (window.GelatosCloud && !window.GelatosCloud.hasSession()) state.screen = 'settings-cloud';
  function saveLocal() { localStorage.setItem(STORE, JSON.stringify(data)); }
  async function syncCloudNow(silent = false) {
    if (cloudSaving || cloudRevision === null || !window.GelatosCloud?.hasSession()) return;
    cloudSaving = true;
    try {
      const saved = await window.GelatosCloud.saveState(data, cloudRevision);
      cloudRevision = Number(saved.revision);
      if (!silent) toast('Alterações salvas na nuvem.');
    } catch (error) {
      if (/CONFLITO/i.test(error.message || '')) {
        try {
          const latest = await window.GelatosCloud.getState();
          data = normalize(latest.state);
          cloudRevision = Number(latest.revision);
          saveLocal();
          render();
          toast('Outra pessoa atualizou os dados. A tela foi atualizada para evitar perda de informações.');
        } catch (_) { toast('Não foi possível atualizar os dados da nuvem agora.'); }
      } else if (!silent) {
        toast('Alteração guardada neste celular. A nuvem será tentada novamente quando houver internet.');
      }
    } finally { cloudSaving = false; }
  }
  function queueCloudSave() {
    if (cloudRevision === null || !window.GelatosCloud?.hasSession()) return;
    clearTimeout(cloudSyncTimer);
    cloudSyncTimer = setTimeout(() => syncCloudNow(true), 800);
  }
  const save = () => { saveLocal(); queueCloudSave(); };
  async function refreshFromCloud(silent = true) {
    if (cloudPolling || cloudRevision === null || !window.GelatosCloud?.hasSession() || document.hidden) return;
    cloudPolling = true;
    try {
      const latest = await window.GelatosCloud.getState();
      if (Number(latest.revision) > Number(cloudRevision)) {
        data = normalize(latest.state);
        cloudRevision = Number(latest.revision);
        saveLocal();
        render();
        if (!silent) toast('Dados atualizados pela nuvem.');
      }
    } catch (_) { /* A cópia local continua disponível sem internet. */ }
    finally { cloudPolling = false; }
  }
  async function loadCloudOnStart() {
    if (!window.GelatosCloud?.hasSession()) return;
    try {
      const remote = await window.GelatosCloud.getState();
      data = normalize(remote.state);
      cloudRevision = Number(remote.revision);
      saveLocal();
      render();
    } catch (_) {
      /* Sem internet, o aplicativo continua com a última cópia salva neste celular. */
    }
  }
  async function confirmLatestStock() {
    if (!window.GelatosCloud?.hasSession()) return true;
    if (cloudRevision === null) {
      toast('Aguarde a nuvem carregar antes de movimentar o estoque.');
      return false;
    }
    try {
      const latest = await window.GelatosCloud.getState();
      if (Number(latest.revision) > Number(cloudRevision)) {
        data = normalize(latest.state);
        cloudRevision = Number(latest.revision);
        saveLocal();
        render();
        toast('O estoque foi atualizado por um pedido novo. Confira as quantidades e confirme novamente.');
        return false;
      }
      return true;
    } catch (_) {
      toast('Não foi possível conferir o estoque na nuvem. Verifique a internet e tente novamente.');
      return false;
    }
  }
  const supplies = () => byId(data.supplies);
  const ready = () => byId(data.readyStock, 'recipeId');
  const recipeById = () => byId(data.recipes);
  const headerLogo = () => data.settings.headerLogoDataUrl || 'logo-transparente-v2.png';
  const homeLogo = () => data.settings.homeLogoDataUrl || headerLogo();
  const detail = (title, subtitle, value, badge, body) => '<details class="list-card"><summary><div class="list-main"><div><h3>' + esc(title) + '</h3><p>' + subtitle + '</p></div><div><span class="badge ' + esc(badge || '') + '">' + esc(badge || '') + '</span><div class="list-value">' + value + '</div></div></div></summary><div class="details-body">' + body + '</div></details>';
  const options = (items, selected, label = item => item.name) => '<option value="">Selecione</option>' + items.map(item => '<option value="' + esc(item.id) + '"' + (String(item.id) === String(selected) ? ' selected' : '') + '>' + esc(label(item)) + '</option>').join('');
  const field = (label, control, help = '') => '<label class="form-field"><span>' + esc(label) + (help ? info(help) : '') + '</span>' + control + '</label>';
  function info(text, title = 'O que significa?') {
    return '<button class="info-button" type="button" aria-label="' + esc(title) + '" data-action="info" data-info-title="' + esc(title) + '" data-info-text="' + esc(text) + '">i</button>';
  }
  function toast(message) {
    const node = $('#toast');
    if (!node) return;
    node.textContent = message;
    node.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => node.classList.remove('show'), 3500);
  }
  function addNotice(type, title, body, route, key = '') {
    if (key && data.notificationKeys.includes(key)) return;
    data.notifications.unshift({ id: uid(), type, title, body, route, key, date: new Date().toISOString(), read: false });
    if (key) data.notificationKeys.push(key);
  }
  function refreshNotices() {
    const active = [];
    data.supplies.forEach(item => {
      if (n(item.minimumStock) > 0 && n(item.quantity) <= n(item.minimumStock)) {
        const key = 'min-supply-' + item.id;
        active.push(key);
        addNotice('stock', 'Estoque mínimo: ' + item.name, 'Restam ' + round(item.quantity) + ' ' + item.unit + '.', item.category === 'supply' ? 'stock-supply' : 'stock-ingredient', key);
      }
    });
    data.readyStock.forEach(item => {
      if (n(item.minimumStock) > 0 && n(item.quantity) <= n(item.minimumStock)) {
        const key = 'min-ready-' + item.recipeId;
        active.push(key);
        addNotice('stock', 'Estoque mínimo: ' + item.name, 'Restam ' + round(item.quantity) + ' geladinhos.', 'stock-ready', key);
      }
    });
    data.orders.filter(order => order.status === 'confirmed' && String(order.dueDate) < today()).forEach(order => {
      const key = 'late-order-' + order.id;
      active.push(key);
      addNotice('payment', 'Pagamento pendente: ' + order.customer, 'Pedido de ' + money(order.total) + ' venceu em ' + brDate(order.dueDate) + '.', 'finance-receivable', key);
    });
    data.notificationKeys = data.notificationKeys.filter(key => !key.startsWith('min-') && !key.startsWith('late-') || active.includes(key));
  }
  function paymentBalances() {
    const values = Object.fromEntries(METHODS.map(method => [method, 0]));
    data.orders.filter(order => order.status === 'paid').forEach(order => values[order.paymentMethod] = round(values[order.paymentMethod] + n(order.total)));
    data.expenses.forEach(expense => values[expense.paymentMethod] = round(values[expense.paymentMethod] - n(expense.total)));
    return values;
  }
  function finance(orders = data.orders.filter(order => order.status === 'paid'), expenses = data.expenses.filter(expense => expense.category !== 'purchase')) {
    const revenue = round(orders.reduce((sum, order) => sum + n(order.total), 0));
    const cost = round(orders.reduce((sum, order) => sum + n(order.cost), 0));
    const expense = round(expenses.reduce((sum, item) => sum + n(item.total), 0));
    return { revenue, cost, expense, profit: round(revenue - cost - expense) };
  }
  function laborCost(recipe, batches = 1) {
    const amount = n(recipe.laborAmount);
    return round((recipe.laborMode === 'unit' ? amount * n(recipe.yieldUnits) : amount) * n(batches));
  }
  function fullRecipeCost(recipe) {
    const material = window.GelatosCore.recipeCost(recipe, supplies());
    const labor = laborCost(recipe);
    const batchCost = round(material.batchCost + labor);
    return { ...material, materialCost: material.batchCost, laborCost: labor, batchCost, unitCost: round(batchCost / n(recipe.yieldUnits)) };
  }
  function createProduction(recipe, batches, date, correction = false) {
    const result = window.GelatosCore.produce(recipe, batches, supplies());
    const labor = laborCost(recipe, batches);
    result.totalCost = round(result.totalCost + labor);
    result.unitCost = round(result.totalCost / result.outputQuantity);
    result.consumed.forEach(line => {
      const item = supplies()[line.supplyId];
      item.quantity = round(n(item.quantity) - n(line.quantity));
      item.movements.push({ id: uid(), kind: correction ? 'Produção corrigida' : 'Produção', quantity: -n(line.quantity), total: n(line.cost), date });
    });
    let product = ready()[recipe.id];
    if (product) {
      const oldQty = n(product.quantity);
      product.unitCost = round((oldQty * n(product.unitCost) + n(result.outputQuantity) * n(result.unitCost)) / (oldQty + n(result.outputQuantity)));
      product.quantity = round(oldQty + n(result.outputQuantity));
      product.saleUnitPrice = n(recipe.saleUnitPrice);
      product.movements.push({ id: uid(), kind: correction ? 'Produção corrigida' : 'Produção', quantity: n(result.outputQuantity), date });
    } else {
      product = { id: uid(), recipeId: recipe.id, name: recipe.name, quantity: n(result.outputQuantity), unitCost: n(result.unitCost), saleUnitPrice: n(recipe.saleUnitPrice), minimumStock: 0, movements: [{ id: uid(), kind: 'Produção', quantity: n(result.outputQuantity), date }] };
      data.readyStock.push(product);
    }
    return result;
  }
  function reverseProduction(production) {
    const product = ready()[production.recipeId];
    if (!product || n(product.quantity) < n(production.outputQuantity)) throw new Error('Não é possível corrigir: parte destes geladinhos já saiu do estoque.');
    (production.consumed || []).forEach(line => {
      const item = supplies()[line.supplyId];
      if (!item) return;
      item.quantity = round(n(item.quantity) + n(line.quantity));
      item.movements.push({ id: uid(), kind: 'Estorno de produção', quantity: n(line.quantity), total: 0, date: today() });
    });
    const remaining = round(n(product.quantity) - n(production.outputQuantity));
    const remainingValue = round(n(product.quantity) * n(product.unitCost) - n(production.outputQuantity) * n(production.unitCost));
    product.quantity = remaining;
    product.unitCost = remaining ? round(remainingValue / remaining) : 0;
    product.movements.push({ id: uid(), kind: 'Estorno de produção', quantity: -n(production.outputQuantity), date: today() });
  }

  function navigate(route) {
    document.body.classList.remove('drawer-open');
    state.notices = false;
    if (route === 'home') state.screen = 'home';
    else if (route === 'recipes' || route === 'production') state.screen = route;
    else if (route.startsWith('orders:')) state.screen = 'orders-' + route.split(':')[1];
    else if (route.startsWith('stock:')) state.screen = 'stock-' + route.split(':')[1];
    else if (route.startsWith('finance:')) state.screen = 'finance-' + route.split(':')[1];
    else if (route.startsWith('reports:')) {
      const [, kind, preset] = route.split(':');
      state.screen = 'reports-' + kind;
      state.reportRanking = preset === 'week' || preset === 'month' || preset === 'all' ? preset : '';
      state.reportFilter = preset ? reportPreset(preset) : { start: '', end: '', min: '', max: '', query: '', payment: '', status: '' };
    } else if (route.startsWith('records:')) state.screen = 'records-' + route.split(':')[1];
    else if (route.startsWith('tools:')) state.screen = 'tools-' + route.split(':')[1];
    else if (route.startsWith('settings:')) state.screen = 'settings-' + route.split(':')[1];
    else state.screen = route;
    render();
    refreshFromCloud(true);
  }
  function reportPreset(preset) {
    const filter = { start: '', end: '', min: '', max: '', query: '', payment: '', status: '' };
    const now = new Date();
    if (preset === 'today') filter.start = filter.end = today();
    if (preset === 'week') {
      const monday = new Date(now);
      monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
      filter.start = monday.toISOString().slice(0, 10);
      filter.end = today();
    }
    if (preset === 'month') {
      filter.start = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-01';
      filter.end = today();
    }
    if (preset === 'year') {
      filter.start = now.getFullYear() + '-01-01';
      filter.end = today();
    }
    return filter;
  }
  function navGroup(label, group, children) {
    const open = state.menu === group;
    return '<section class="nav-group ' + (open ? 'open' : '') + '"><button class="nav-heading" data-menu="' + group + '">' + esc(label) + '<span>⌄</span></button><div class="nav-children">' + children.map(child => '<button data-route="' + child[1] + '">' + esc(child[0]) + '</button>').join('') + '</div></section>';
  }
  function shell() {
    const unread = data.notifications.filter(item => !item.read).length;
    return '<div class="app-shell"><header class="topbar"><button class="icon-button" data-action="open-menu" aria-label="Abrir menu">☰</button><img class="brand" src="' + esc(headerLogo()) + '" alt="Gelatos Lele"><button class="bell-button" data-action="open-notices" aria-label="Notificações">🔔' + (unread ? '<b>' + unread + '</b>' : '') + '</button><button id="installCta" class="install-cta" hidden>Instalar</button></header><div class="drawer-shade" data-action="close-menu"></div><aside class="drawer"><div class="drawer-brand"><img src="' + esc(headerLogo()) + '" alt="Gelatos Lele"><button class="icon-button" data-action="close-menu" aria-label="Fechar menu">×</button></div><nav><button class="nav-home" data-route="home">Tela inicial</button>' +
      navGroup('Controle de pedidos', 'orders', [['Novo pedido', 'orders:new'], ['Pedidos realizados', 'orders:history']]) +
      navGroup('Controle de estoque', 'stock', [['Cadastrar compra', 'stock:purchase'], ['Estoque produzido', 'stock:ready'], ['Estoque de insumos', 'stock:supply'], ['Estoque de ingredientes', 'stock:ingredient'], ['Produções', 'production'], ['Nova receita', 'recipes']]) +
      navGroup('Financeiro', 'finance', [['Visão financeira', 'finance:overview'], ['Contas a receber', 'finance:receivable'], ['Contas pagas', 'finance:payable']]) +
      navGroup('Relatórios', 'reports', [['Pedidos', 'reports:orders'], ['Financeiro', 'reports:finance'], ['Estoque', 'reports:stock']]) +
      navGroup('Cadastros', 'records', [['Cardápio / sabores', 'records:catalog'], ['Ingredientes', 'stock:ingredient'], ['Insumos', 'stock:supply'], ['Fornecedores', 'records:suppliers']]) +
      navGroup('Ferramentas', 'tools', [['Comparar preço', 'tools:compare'], ['Produção possível', 'tools:capacity']]) +
      navGroup('Configurações', 'settings', [['Visão geral', 'settings:home'], ['Nuvem e sincronização', 'settings:cloud'], ['Logo do app', 'settings:appearance'], ['Mensagem e Pix', 'settings:message'], ['Cardápio do cliente', 'settings:catalog'], ['Frete e entrega', 'settings:delivery'], ['Backup', 'settings:backup']]) +
      '</nav></aside><main>' + screen() + '</main>' + noticesPanel() + infoPanel() + '</div><div id="toast" role="status" aria-live="polite"></div>';
  }
  function heading(kicker, title, description) {
    return '<div class="screen-heading"><p>' + esc(kicker) + '</p><h1>' + esc(title) + '</h1><span>' + esc(description) + '</span></div>';
  }
  function metric(label, id, text, route, featured = false) {
    return '<button class="metric ' + (featured ? 'featured' : '') + '" data-route="' + route + '"><small>' + esc(label) + '</small><strong id="' + id + '">—</strong><span>' + esc(text) + '</span><em>Ver detalhes</em></button>';
  }
  function bestSellers(filter) {
    const counts = {};
    data.orders.filter(order => order.status === 'paid' && filter(order)).forEach(order => order.items.forEach(line => counts[line.productName] = round((counts[line.productName] || 0) + n(line.quantity))));
    return Object.entries(counts).map(([name, quantity]) => ({ name, quantity })).sort((a, b) => b.quantity - a.quantity || a.name.localeCompare(b.name)).slice(0, 3);
  }
  function bestCard(label, entries, route) {
    return '<button class="best-card" data-route="' + route + '"><small>' + esc(label) + '</small><div>' + (entries.length ? entries.map((item, index) => '<span><b>' + (index + 1) + '.</b> ' + esc(item.name) + '<em>' + item.quantity + ' un.</em></span>').join('') : '<span>Nenhuma venda paga ainda.</span>') + '</div></button>';
  }
  function homeScreen() {
    const now = new Date();
    const monday = new Date(now);
    monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    const weekStart = monday.toISOString().slice(0, 10);
    const currentMonth = date => new Date(date + 'T12:00:00').getMonth() === now.getMonth() && new Date(date + 'T12:00:00').getFullYear() === now.getFullYear();
    return '<section class="screen active"><div class="welcome"><img src="' + esc(homeLogo()) + '" alt="Gelatos Lele"><span>Visão geral da empresa</span></div><div class="dashboard-grid">' +
      metric('Geladinhos prontos', 'dashReady', 'Estoque disponível', 'stock:ready', true) +
      metric('Pedidos de hoje', 'dashOrders', 'Pedidos criados hoje', 'reports:orders:today') +
      metric('Recebido hoje', 'dashToday', 'Somente pedidos pagos', 'reports:finance:today') +
      metric('Faturamento do mês', 'dashMonth', 'Pedidos pagos no mês', 'reports:finance:month') +
      metric('Faturamento do ano', 'dashYear', 'Pedidos pagos no ano', 'reports:finance:year') +
      metric('Lucro real do mês', 'dashProfit', 'Vendas − custo − despesas', 'reports:finance:month') +
      '</div><section class="panel balance-panel"><h2>Caixa e conta</h2><div class="payment-balances"><span>Dinheiro <b id="dashCash">—</b></span><span>Pix / conta <b id="dashPix">—</b></span><span>Crédito <b id="dashCredit">—</b></span><span>Débito <b id="dashDebit">—</b></span></div></section><h2 class="section-title">Sabores mais vendidos</h2><div class="best-grid">' +
      bestCard('Na semana', bestSellers(order => day(order.paidAt || order.date) >= weekStart), 'reports:orders:week') +
      bestCard('No mês', bestSellers(order => currentMonth(day(order.paidAt || order.date))), 'reports:orders:month') +
      bestCard('No geral', bestSellers(() => true), 'reports:orders:all') +
      '</div><h2 class="section-title">Atalhos</h2><div class="shortcuts"><button data-route="orders:new"><b>Novo pedido</b><span>Venda e confirmação</span></button><button data-route="stock:purchase"><b>Registrar compra</b><span>Itens e fornecedor</span></button><button data-route="production"><b>Produzir lote</b><span>Baixa automática</span></button><button data-route="recipes"><b>Nova receita</b><span>Custo por item</span></button></div></section>';
  }
  function screen() {
    if (state.screen === 'home') return homeScreen();
    if (state.screen === 'orders-new' || state.screen === 'orders-history') return ordersScreen();
    if (state.screen === 'order-edit') return orderEditScreen();
    if (state.screen === 'stock-purchase' || state.screen === 'stock-ingredient' || state.screen === 'stock-supply' || state.screen === 'stock-ready') return stockScreen();
    if (state.screen === 'stock-ready-manual') return manualReadyScreen();
    if (state.screen === 'supply-edit') return supplyEditScreen();
    if (state.screen === 'ready-edit') return readyEditScreen();
    if (state.screen === 'recipes') return recipeScreen();
    if (state.screen === 'production') return productionScreen();
    if (state.screen === 'production-edit') return productionEditScreen();
    if (state.screen.startsWith('finance-')) return financeScreen();
    if (state.screen.startsWith('reports-')) return reportsScreen();
    if (state.screen === 'records-catalog') return catalogScreen();
    if (state.screen === 'records-suppliers') return supplierScreen();
    if (state.screen === 'supplier-edit') return supplierEditScreen();
    if (state.screen.startsWith('tools-')) return toolsScreen();
    if (state.screen.startsWith('settings-')) return settingsScreen();
    return homeScreen();
  }
  function orderLinesMarkup() {
    const products = data.readyStock.filter(item => n(item.quantity) > 0).map(item => ({ ...item, id: item.recipeId }));
    return state.orderLines.map((line, index) => '<div class="order-line"><select data-order-product="' + index + '">' + options(products, line.productId, item => item.name + ' · ' + round(item.quantity) + ' un. · ' + money(item.saleUnitPrice)) + '</select><input data-order-quantity="' + index + '" inputmode="decimal" value="' + esc(line.quantity) + '" aria-label="Quantidade"><button type="button" class="line-remove" data-action="remove-order-line" data-index="' + index + '" aria-label="Remover item">×</button></div>').join('');
  }
  function draftOrderTotal() {
    return round(state.orderLines.reduce((sum, line) => {
      const product = ready()[line.productId];
      return sum + (product ? n(line.quantity) * n(product.saleUnitPrice) : 0);
    }, 0));
  }
  function rememberOrderDraft() {
    const form = $('#orderForm');
    if (!form) return;
    const f = form.elements;
    state.orderDraft = {
      customer: f.customer?.value || '',
      phone: f.phone?.value || '',
      payment: f.payment?.value || 'Pix',
      date: f.date?.value || today(),
      dueDate: f.dueDate?.value || today()
    };
  }
  function orderStatus(order) {
    return order.status === 'paid' ? 'pago' : order.status === 'cancelled' ? 'cancelado' : 'pendente';
  }
  function orderCard(order) {
    const lines = order.items.map(item => '<li>' + round(item.quantity) + ' × ' + esc(item.productName) + ' — ' + money(item.total) + '</li>').join('');
    const pick = order.items.map((item, index) => '<label><input type="checkbox" data-pick="' + esc(order.id) + ':' + index + '"' + (item.picked ? ' checked' : '') + (order.status === 'cancelled' ? ' disabled' : '') + '> Separar ' + round(item.quantity) + ' × ' + esc(item.productName) + '</label>').join('');
    let actions = '<button class="outline" data-action="edit-order" data-id="' + esc(order.id) + '">Editar</button><button class="secondary" data-action="send-order" data-id="' + esc(order.id) + '">Enviar confirmação</button>';
    if (order.status === 'confirmed') actions += '<button class="primary" data-action="mark-paid" data-id="' + esc(order.id) + '">Marcar como pago</button>';
    if (order.status !== 'cancelled') actions += '<button class="outline" data-action="cancel-order" data-id="' + esc(order.id) + '">Cancelar</button>';
    actions += '<button class="outline danger-button" data-action="delete-order" data-id="' + esc(order.id) + '">Excluir</button>';
    return detail(order.customer, brDate(order.date) + ' · vence ' + brDate(order.dueDate) + ' · ' + esc(order.paymentMethod), money(order.total), orderStatus(order), '<dl><dt>WhatsApp</dt><dd>' + esc(order.phone || 'não informado') + '</dd><dt>Custo vendido</dt><dd>' + money(order.cost) + '</dd><dt>Lucro da venda</dt><dd>' + money(order.profit) + '</dd></dl><h4>Checklist de separação</h4><div class="pick-list">' + pick + '</div><h4>Itens</h4><ul>' + lines + '</ul><div class="details-actions">' + actions + '</div>');
  }
  function ordersScreen() {
    if (state.screen === 'orders-history') {
      const cards = data.orders.slice().sort((a, b) => String(b.date).localeCompare(String(a.date))).map(orderCard).join('') || empty('Nenhum pedido criado ainda.');
      return '<section class="screen active">' + heading('Controle de pedidos', 'Pedidos realizados', 'Abra um pedido para separar, editar, confirmar pagamento, cancelar ou excluir.') + '<div class="list">' + cards + '</div></section>';
    }
    const draft = state.orderDraft || { customer: '', phone: '', payment: 'Pix', date: today(), dueDate: today() };
    return '<section class="screen active">' + heading('Controle de pedidos', 'Novo pedido', 'Selecione os geladinhos prontos. O total é atualizado antes de confirmar.') + '<form id="orderForm" class="panel form-panel"><h2>Dados do cliente</h2><div class="form-grid two">' +
      field('Nome do cliente', '<input name="customer" required value="' + esc(draft.customer) + '" placeholder="Ex.: Maria">') +
      field('WhatsApp', '<input name="phone" inputmode="tel" value="' + esc(draft.phone) + '" placeholder="Ex.: 11999999999">') +
      '</div><div class="section-line"><div><h3>Itens do pedido</h3><p>Escolha somente itens disponíveis no estoque produzido.</p></div></div><div class="line-list">' + orderLinesMarkup() + '</div><button type="button" class="outline full" data-action="add-order-line">+ Adicionar outro geladinho</button><div class="form-grid two">' +
      field('Forma de pagamento', '<select name="payment">' + METHODS.map(method => '<option' + (draft.payment === method ? ' selected' : '') + '>' + method + '</option>').join('') + '</select>') +
      field('Vencimento / data esperada', '<input name="dueDate" type="date" value="' + esc(draft.dueDate) + '">', 'É a data usada para avisar que o pedido ainda não foi pago.') +
      field('Data do pedido', '<input name="date" type="date" value="' + esc(draft.date) + '">') +
      '</div><div class="calculation-row"><span>Total do pedido</span><b id="orderPreview">' + money(draftOrderTotal()) + '</b><small>O pedido entra no faturamento e lucro quando for marcado como pago.</small></div><button class="primary full">Confirmar pedido e reservar estoque</button></form></section>';
  }
  function orderEditScreen() {
    const order = data.orders.find(item => String(item.id) === String(state.editOrder));
    if (!order) return '<section class="screen active">' + empty('Pedido não encontrado.') + '</section>';
    const draft = state.orderDraft || { customer: order.customer, phone: order.phone || '', payment: order.paymentMethod, date: order.date, dueDate: order.dueDate };
    return '<section class="screen active">' + heading('Controle de pedidos', 'Editar pedido', 'As quantidades, o total, custo e reserva do estoque são recalculados ao salvar.') + '<form id="orderEditForm" class="panel form-panel"><input type="hidden" name="id" value="' + esc(order.id) + '"><div class="form-grid two">' +
      field('Nome do cliente', '<input name="customer" required value="' + esc(draft.customer) + '">') +
      field('WhatsApp', '<input name="phone" inputmode="tel" value="' + esc(draft.phone) + '">') +
      field('Forma de pagamento', '<select name="payment">' + METHODS.map(method => '<option' + (draft.payment === method ? ' selected' : '') + '>' + method + '</option>').join('') + '</select>') +
      field('Vencimento', '<input name="dueDate" type="date" value="' + esc(draft.dueDate) + '">') +
      field('Data do pedido', '<input name="date" type="date" value="' + esc(draft.date) + '">') +
      '</div><div class="section-line"><div><h3>Itens</h3><p>A situação do pedido continua paga, pendente ou cancelada.</p></div></div><div class="line-list">' + orderLinesMarkup() + '</div><button type="button" class="outline full" data-action="add-order-line">+ Adicionar outro geladinho</button><div class="calculation-row"><span>Novo total</span><b id="orderPreview">' + money(draftOrderTotal()) + '</b></div><div class="button-row"><button class="primary">Salvar alterações</button><button class="outline" type="button" data-route="orders:history">Cancelar</button></div></form></section>';
  }
  function stockScreen() {
    if (state.screen === 'stock-purchase') return purchaseScreen();
    if (state.screen === 'stock-ready') return readyScreen();
    const category = state.screen === 'stock-supply' ? 'supply' : 'ingredient';
    const label = category === 'supply' ? 'Estoque de insumos' : 'Estoque de ingredientes';
    const cards = data.supplies.filter(item => item.category === category).sort((a, b) => a.name.localeCompare(b.name)).map(item => {
      const moves = item.movements.slice(-8).reverse().map(move => '<li>' + brDate(move.date) + ' · ' + esc(move.kind) + ' · ' + (n(move.quantity) >= 0 ? '+' : '') + round(move.quantity) + ' ' + esc(item.unit) + '</li>').join('') || '<li>Sem movimentações.</li>';
      return detail(item.name, 'Quantidade: ' + round(item.quantity) + ' ' + esc(item.unit) + ' · mínimo: ' + round(item.minimumStock), money(item.averageUnitCost) + '/' + esc(item.unit), n(item.minimumStock) > 0 && n(item.quantity) <= n(item.minimumStock) ? 'mínimo' : 'em estoque', '<dl><dt>Quantidade atual</dt><dd>' + round(item.quantity) + ' ' + esc(item.unit) + '</dd><dt>Custo médio</dt><dd>' + money(item.averageUnitCost) + ' / ' + esc(item.unit) + '</dd><dt>Valor em estoque</dt><dd>' + money(n(item.quantity) * n(item.averageUnitCost)) + '</dd><dt>Última compra</dt><dd>' + brDate(item.lastPurchaseAt) + '</dd><dt>Fornecedor</dt><dd>' + esc(item.lastSupplierName || '—') + '</dd></dl><h4>Movimentações recentes</h4><ul>' + moves + '</ul><div class="details-actions"><button class="outline" data-action="edit-supply" data-id="' + esc(item.id) + '">Editar</button><button class="outline danger-button" data-action="delete-supply" data-id="' + esc(item.id) + '">Excluir</button></div>');
    }).join('') || empty('Nenhum item cadastrado.');
    return '<section class="screen active">' + heading('Controle de estoque', label, 'Toque em um item para conferir movimentações ou editar todas as informações.') + '<div class="isolated-actions"><button class="primary" data-route="stock:purchase">Cadastrar nova compra</button></div><div class="list">' + cards + '</div></section>';
  }
  function purchaseScreen() {
    return '<section class="screen active">' + heading('Controle de estoque', 'Cadastrar compra', 'Registre a entrada uma vez. O custo médio e o financeiro são atualizados automaticamente.') + '<form id="purchaseForm" class="panel form-panel"><div class="form-grid two">' +
      field('Item já cadastrado', '<select name="supplyId">' + options(data.supplies.slice().sort((a, b) => a.name.localeCompare(b.name)), '', item => item.name + ' (' + round(item.quantity) + ' ' + item.unit + ')') + '</select>', 'Selecione aqui quando estiver comprando novamente algo que já existe.') +
      field('Ou nome do novo item', '<input name="newName" placeholder="Ex.: Leite integral">', 'Preencha somente se este item ainda não foi cadastrado.') +
      field('Tipo do novo item', '<select name="category"><option value="ingredient">Ingrediente</option><option value="supply">Insumo / embalagem</option></select>') +
      field('Unidade de medida', '<select name="unit"><option>un.</option><option>pacote</option><option>L</option><option>ml</option><option>kg</option><option>g</option><option>rolo</option><option>caixa</option></select>') +
      field('Estoque mínimo', '<input name="minimumStock" inputmode="decimal" placeholder="Ex.: 5">', 'Quando a quantidade chegar a este número, o sino mostrará um aviso.') +
      field('Fornecedor', '<select name="supplierId">' + options(data.suppliers, '') + '</select>') +
      field('Quantidade comprada', '<input name="quantity" required inputmode="decimal" placeholder="Ex.: 2">') +
      field('Total pago (R$)', '<input name="total" required inputmode="decimal" placeholder="Ex.: 5,98">', 'É o total da compra, não o preço de cada unidade.') +
      field('Pago com', '<select name="payment">' + METHODS.map(method => '<option>' + method + '</option>').join('') + '</select>') +
      field('Data da compra', '<input name="date" type="date" value="' + today() + '">') +
      '</div><button class="primary full">Lançar compra no estoque</button></form><p class="form-note">Não encontrou o fornecedor? Cadastre-o em Cadastros › Fornecedores.</p></section>';
  }
  function readyScreen() {
    const cards = data.readyStock.slice().sort((a, b) => a.name.localeCompare(b.name)).map(item => {
      const recipe = recipeById()[item.recipeId];
      const recipeLines = recipe ? recipe.items.map(line => '<li>' + esc(supplies()[line.supplyId]?.name || 'Item removido') + ': ' + round(line.quantity) + ' ' + esc(line.unit) + '</li>').join('') : '<li>Receita não localizada.</li>';
      const movements = item.movements.slice(-8).reverse().map(move => '<li>' + brDate(move.date) + ' · ' + esc(move.kind) + ' · ' + (n(move.quantity) >= 0 ? '+' : '') + round(move.quantity) + ' un.</li>').join('') || '<li>Sem movimentações.</li>';
      return detail(item.name, 'Quantidade: ' + round(item.quantity) + ' un. · mínimo: ' + round(item.minimumStock), money(item.saleUnitPrice), n(item.minimumStock) > 0 && n(item.quantity) <= n(item.minimumStock) ? 'mínimo' : 'pronto', '<dl><dt>Custo por unidade</dt><dd>' + money(item.unitCost) + '</dd><dt>Preço de venda</dt><dd>' + money(item.saleUnitPrice) + '</dd><dt>Valor em estoque</dt><dd>' + money(n(item.quantity) * n(item.unitCost)) + '</dd></dl><h4>Receita</h4><ul>' + recipeLines + '</ul><h4>Movimentações recentes</h4><ul>' + movements + '</ul><div class="details-actions"><button class="outline" data-action="edit-ready" data-id="' + esc(item.recipeId) + '">Editar</button><button class="outline danger-button" data-action="delete-ready" data-id="' + esc(item.recipeId) + '">Excluir cadastro vazio</button></div>');
    }).join('') || empty('Ainda não há geladinhos prontos.');
    return '<section class="screen active">' + heading('Controle de estoque', 'Estoque produzido', 'Veja o que está pronto para vender. Produza lotes ou corrija uma contagem.') + '<div class="isolated-actions"><button class="primary" data-route="production">Produzir lote</button><button class="secondary" data-action="new-ready">Adicionar contagem inicial</button></div><div class="list">' + cards + '</div></section>';
  }
  function manualReadyScreen() {
    return '<section class="screen active">' + heading('Estoque produzido', 'Adicionar contagem inicial', 'Use para registrar uma contagem inicial ou correção. Para fabricar, use Produzir lote.') + '<form id="manualReadyForm" class="panel form-panel"><div class="form-grid two">' +
      field('Receita / sabor', '<select name="recipeId">' + options(data.recipes, '') + '</select>') +
      field('Quantidade pronta', '<input name="quantity" required inputmode="decimal">') +
      field('Custo por unidade (R$)', '<input name="unitCost" inputmode="decimal" placeholder="Usa o custo da receita se vazio">', 'Preencha somente se quiser corrigir o custo calculado pela receita.') +
      field('Estoque mínimo', '<input name="minimumStock" inputmode="decimal" placeholder="Ex.: 10">') +
      field('Data', '<input name="date" type="date" value="' + today() + '">') +
      '</div><div class="button-row"><button class="primary">Salvar estoque produzido</button><button class="outline" type="button" data-route="stock:ready">Cancelar</button></div></form></section>';
  }
  function supplyEditScreen() {
    const item = supplies()[state.editSupply];
    if (!item) return '<section class="screen active">' + empty('Item não encontrado.') + '</section>';
    return '<section class="screen active">' + heading('Controle de estoque', 'Editar ' + item.name, 'Altere todas as informações de uma vez. A correção de quantidade ficará registrada no histórico.') + '<form id="supplyEditForm" class="panel form-panel"><input type="hidden" name="id" value="' + esc(item.id) + '"><div class="form-grid two">' +
      field('Nome', '<input name="name" required value="' + esc(item.name) + '">') +
      field('Tipo', '<select name="category"><option value="ingredient"' + (item.category === 'ingredient' ? ' selected' : '') + '>Ingrediente</option><option value="supply"' + (item.category === 'supply' ? ' selected' : '') + '>Insumo / embalagem</option></select>') +
      field('Unidade de medida', '<input name="unit" required value="' + esc(item.unit) + '">') +
      field('Quantidade atual', '<input name="quantity" required inputmode="decimal" value="' + esc(String(item.quantity).replace('.', ',')) + '">', 'Quantidade física que existe agora.') +
      field('Custo médio por unidade (R$)', '<input name="averageUnitCost" required inputmode="decimal" value="' + esc(String(item.averageUnitCost).replace('.', ',')) + '">', 'Custo usado para calcular a receita a partir de agora.') +
      field('Estoque mínimo', '<input name="minimumStock" inputmode="decimal" value="' + esc(String(item.minimumStock).replace('.', ',')) + '">') +
      field('Data da última compra', '<input name="lastPurchaseAt" type="date" value="' + esc(item.lastPurchaseAt || '') + '">') +
      field('Fornecedor da última compra', '<input name="lastSupplierName" value="' + esc(item.lastSupplierName || '') + '">') +
      '</div><div class="button-row"><button class="primary">Salvar todas as alterações</button><button class="outline" type="button" data-route="stock:' + (item.category === 'supply' ? 'supply' : 'ingredient') + '">Cancelar</button><button class="outline danger-button" type="button" data-action="delete-supply" data-id="' + esc(item.id) + '">Excluir cadastro</button></div></form></section>';
  }
  function readyEditScreen() {
    const item = ready()[state.editReady];
    if (!item) return '<section class="screen active">' + empty('Geladinho não encontrado.') + '</section>';
    return '<section class="screen active">' + heading('Estoque produzido', 'Editar ' + item.name, 'Corrija quantidade, custo, preço e estoque mínimo em uma só tela.') + '<form id="readyEditForm" class="panel form-panel"><input type="hidden" name="recipeId" value="' + esc(item.recipeId) + '"><div class="form-grid two">' +
      field('Quantidade atual', '<input name="quantity" required inputmode="decimal" value="' + esc(String(item.quantity).replace('.', ',')) + '">') +
      field('Custo por unidade (R$)', '<input name="unitCost" required inputmode="decimal" value="' + esc(String(item.unitCost).replace('.', ',')) + '">') +
      field('Preço de venda (R$)', '<input name="saleUnitPrice" required inputmode="decimal" value="' + esc(String(item.saleUnitPrice).replace('.', ',')) + '">') +
      field('Estoque mínimo', '<input name="minimumStock" inputmode="decimal" value="' + esc(String(item.minimumStock).replace('.', ',')) + '">') +
      '</div><div class="button-row"><button class="primary">Salvar todas as alterações</button><button class="outline" type="button" data-route="stock:ready">Cancelar</button><button class="outline danger-button" type="button" data-action="delete-ready" data-id="' + esc(item.recipeId) + '">Excluir cadastro vazio</button></div></form></section>';
  }
  function recipeRows() {
    const list = data.supplies.slice().sort((a, b) => a.name.localeCompare(b.name));
    return state.recipeLines.map((line, index) => '<div class="recipe-item"><select data-recipe-supply="' + index + '">' + options(list, line.supplyId, item => item.name + ' (' + item.unit + ')') + '</select><input data-recipe-quantity="' + index + '" inputmode="decimal" value="' + esc(line.quantity) + '" aria-label="Quantidade"><input data-recipe-unit="' + index + '" value="' + esc(line.unit) + '" aria-label="Unidade"><button class="line-remove" type="button" data-action="remove-recipe-line" data-index="' + index + '" aria-label="Remover ingrediente">×</button></div>').join('');
  }
  function recipeDraftFromScreen() {
    const form = $('#recipeForm');
    const f = form?.elements;
    return {
      id: form ? control(form, 'id')?.value || '' : '',
      name: form ? control(form, 'name')?.value || '' : '',
      yieldUnits: f?.yieldUnits?.value || '',
      saleUnitPrice: f?.saleUnitPrice?.value || '',
      laborAmount: f?.laborAmount?.value || '',
      laborMode: f?.laborMode?.value || 'batch',
      preparation: f?.preparation?.value || '',
      description: f?.description?.value || '',
      active: f?.active ? f.active.checked : true
    };
  }
  function recipeDraftCost() {
    const draft = recipeDraftFromScreen();
    const candidate = {
      ...draft,
      yieldUnits: n(draft.yieldUnits),
      laborAmount: n(draft.laborAmount),
      items: state.recipeLines.map(line => ({ supplyId: line.supplyId, quantity: n(line.quantity), unit: line.unit })).filter(line => line.supplyId && line.quantity > 0 && line.unit)
    };
    if (!candidate.items.length || !(candidate.yieldUnits > 0)) return null;
    try { return fullRecipeCost(candidate); } catch (_) { return null; }
  }
  function updateRecipePreview() {
    const cost = recipeDraftCost();
    const total = $('#recipePreview');
    const detailText = $('#recipeDetailPreview');
    if (total) total.textContent = money(cost?.batchCost || 0);
    if (detailText) detailText.textContent = cost ? 'Materiais: ' + money(cost.materialCost) + ' · mão de obra: ' + money(cost.laborCost) + ' · ' + money(cost.unitCost) + ' por geladinho' : 'Complete rendimento, item, quantidade e unidade para calcular.';
  }
  function recipeScreen() {
    const editing = state.editRecipe ? recipeById()[state.editRecipe] : null;
    if (editing && !state.recipeLinesLoaded) {
      state.recipeLines = editing.items.map(item => ({ ...item }));
      state.recipeDraft = { ...editing };
      state.recipeLinesLoaded = true;
    }
    const base = editing || state.recipeDraft || { name: '', yieldUnits: '', saleUnitPrice: '', laborAmount: '', laborMode: 'batch', preparation: '', description: '', active: true };
    const estimation = (() => {
      try {
        const candidate = { ...base, items: state.recipeLines.map(line => ({ supplyId: line.supplyId, quantity: n(line.quantity), unit: line.unit })).filter(line => line.supplyId && line.quantity > 0 && line.unit) };
        return candidate.items.length && n(candidate.yieldUnits) > 0 ? fullRecipeCost(candidate) : null;
      } catch (_) { return null; }
    })();
    return '<section class="screen active">' + heading('Receitas', editing ? 'Editar receita' : 'Nova receita', 'Cadastre o sabor, os ingredientes, embalagens, modo de preparo e custo do lote.') + '<form id="recipeForm" class="panel form-panel"><input type="hidden" name="id" value="' + esc(editing?.id || '') + '"><div class="form-grid two">' +
      field('Nome do sabor', '<input name="name" required value="' + esc(base.name || '') + '" placeholder="Ex.: Ninho com Nutella">') +
      field('Rendimento do lote (un.)', '<input name="yieldUnits" required inputmode="decimal" value="' + esc(base.yieldUnits || '') + '">', 'Quantidade de geladinhos que esta receita completa produz.') +
      field('Preço de venda por unidade (R$)', '<input name="saleUnitPrice" required inputmode="decimal" value="' + esc(String(base.saleUnitPrice || '').replace('.', ',')) + '">') +
      field('Mão de obra (R$)', '<input name="laborAmount" inputmode="decimal" value="' + esc(String(base.laborAmount || '').replace('.', ',')) + '">', 'Será incluída no custo do lote.') +
      field('Como calcular a mão de obra', '<select name="laborMode"><option value="batch"' + ((base.laborMode || 'batch') === 'batch' ? ' selected' : '') + '>Valor por lote</option><option value="unit"' + (base.laborMode === 'unit' ? ' selected' : '') + '>Valor por geladinho</option></select>') +
      field('Imagem do sabor', '<input name="image" type="file" accept="image/*">', 'Opcional. É usada somente no cardápio do cliente.') +
      '</div><label class="form-field"><span>Descrição para o cliente' + info('Esta descrição aparece no cardápio que você compartilha com os clientes.', 'Descrição do cardápio') + '</span><textarea name="description" rows="3" placeholder="Ex.: Creme de leite Ninho com recheio de Nutella.">' + esc(base.description || '') + '</textarea></label><div class="catalog-switch"><label><input name="active" type="checkbox"' + (base.active !== false ? ' checked' : '') + '> Disponível no cardápio</label><span>O cardápio do cliente mostra exatamente os sabores ativos cadastrados em Cadastros › Cardápio / sabores, desde que estejam em estoque.</span></div><div class="section-line"><div><h3>Ingredientes e embalagens</h3><p>Na própria linha: selecione o item, informe a quantidade e a unidade.</p></div></div><div class="recipe-table-title"><span>Item</span><span>Quantidade</span><span>Unidade</span><span></span></div><div class="recipe-items">' + recipeRows() + '</div><button type="button" class="outline full" data-action="add-recipe-line">+ Adicionar item abaixo</button><label class="form-field"><span>Modo de preparo</span><textarea name="preparation" rows="5" placeholder="Explique o preparo passo a passo.">' + esc(base.preparation || '') + '</textarea></label><div class="calculation-row"><span>Custo total do lote</span><b id="recipePreview">' + money(estimation?.batchCost || 0) + '</b><small id="recipeDetailPreview">' + (estimation ? 'Materiais: ' + money(estimation.materialCost) + ' · mão de obra: ' + money(estimation.laborCost) + ' · ' + money(estimation.unitCost) + ' por geladinho' : 'Complete rendimento, item, quantidade e unidade para calcular.') + '</small></div><div class="button-row"><button class="primary">Salvar receita</button>' + (editing ? '<button class="outline" type="button" data-action="cancel-recipe-edit">Cancelar</button>' : '') + '</div></form></section>';
  }
  function productionScreen() {
    const selected = recipeById()[state.productionRecipe] || null;
    const batches = n(state.productionBatches || 1);
    let preview = 'Selecione uma receita e informe os lotes.';
    if (selected && batches > 0) {
      try {
        const material = window.GelatosCore.produce(selected, batches, supplies());
        const labor = laborCost(selected, batches);
        const total = round(material.totalCost + labor);
        preview = '<strong>Serão produzidos ' + material.outputQuantity + ' geladinhos</strong><span>Materiais: ' + money(material.totalCost) + ' · mão de obra: ' + money(labor) + ' · custo total: ' + money(total) + ' · ' + money(total / material.outputQuantity) + ' por unidade</span><ul>' + material.consumed.map(line => '<li>' + esc(supplies()[line.supplyId]?.name || 'Item') + ': baixa de ' + round(line.quantity) + ' ' + esc(supplies()[line.supplyId]?.unit || '') + '</li>').join('') + '</ul>';
      } catch (error) {
        preview = '<strong>Não é possível produzir ainda</strong><span>' + esc(error.message) + '</span>';
      }
    }
    return '<section class="screen active">' + heading('Controle de estoque', 'Produzir lote', 'O app confere os ingredientes antes de baixar o estoque e não permite produzir sem material.') + '<form id="productionForm" class="panel form-panel"><div class="form-grid two">' +
      field('Receita', '<select name="recipeId" id="productionRecipe">' + options(data.recipes, selected?.id || '', item => item.name) + '</select>') +
      field('Quantidade de lotes', '<input name="batches" id="productionBatches" required inputmode="decimal" value="' + esc(state.productionBatches || 1) + '">') +
      field('Data da produção', '<input name="date" type="date" value="' + today() + '">') +
      '</div><div class="production-preview" id="productionPreview">' + preview + '</div><button class="primary full">Registrar produção</button></form><section class="panel"><h2>Produções lançadas</h2><div class="list compact">' + productionCards() + '</div></section></section>';
  }
  function productionCards() {
    return data.productions.slice().sort((a, b) => String(b.date).localeCompare(String(a.date))).map(item => detail(item.recipeName, brDate(item.date) + ' · ' + round(item.batches) + ' lote(s)', round(item.outputQuantity) + ' un.', 'produção', '<dl><dt>Custo total</dt><dd>' + money(item.totalCost) + '</dd><dt>Custo por unidade</dt><dd>' + money(item.unitCost) + '</dd></dl><div class="details-actions"><button class="outline" data-action="edit-production" data-id="' + esc(item.id) + '">Editar</button><button class="outline danger-button" data-action="delete-production" data-id="' + esc(item.id) + '">Excluir</button></div>')).join('') || empty('Nenhuma produção registrada.');
  }
  function productionEditScreen() {
    const production = data.productions.find(item => String(item.id) === String(state.editProduction));
    if (!production) return '<section class="screen active">' + empty('Produção não encontrada.') + '</section>';
    return '<section class="screen active">' + heading('Produções', 'Editar produção', 'A correção devolve o lote anterior e lança novamente a quantidade informada, sem permitir saldo negativo.') + '<form id="productionEditForm" class="panel form-panel"><input type="hidden" name="id" value="' + esc(production.id) + '"><div class="form-grid two">' +
      field('Receita', '<input value="' + esc(production.recipeName) + '" disabled>') +
      field('Quantidade de lotes', '<input name="batches" required inputmode="decimal" value="' + esc(production.batches) + '">') +
      field('Data da produção', '<input name="date" type="date" value="' + esc(production.date) + '">') +
      '</div><div class="button-row"><button class="primary">Salvar produção</button><button class="outline" type="button" data-route="production">Cancelar</button><button class="outline danger-button" type="button" data-action="delete-production" data-id="' + esc(production.id) + '">Excluir</button></div></form></section>';
  }
  function expenseForm(expense = null) {
    const edit = Boolean(expense);
    return '<form id="' + (edit ? 'expenseEditForm' : 'expenseForm') + '" class="panel form-panel">' + (edit ? '<input type="hidden" name="id" value="' + esc(expense.id) + '">' : '') + '<div class="form-grid two">' +
      field('Descrição', '<input name="name" required value="' + esc(expense?.name || '') + '" placeholder="Ex.: Frete">') +
      field('Valor (R$)', '<input name="total" required inputmode="decimal" value="' + esc(expense ? String(expense.total).replace('.', ',') : '') + '">', 'Saída de caixa da empresa que não é compra de estoque.') +
      field('Pago com', '<select name="payment">' + METHODS.map(method => '<option' + (expense?.paymentMethod === method ? ' selected' : '') + '>' + method + '</option>').join('') + '</select>') +
      field('Data', '<input name="date" type="date" value="' + esc(expense?.date || today()) + '">') +
      '</div><div class="button-row"><button class="' + (edit ? 'primary' : 'secondary') + '">' + (edit ? 'Salvar alterações' : 'Registrar conta paga') + '</button>' + (edit ? '<button class="outline" type="button" data-route="finance:payable">Cancelar</button><button class="outline danger-button" type="button" data-action="delete-expense" data-id="' + esc(expense.id) + '">Excluir</button>' : '') + '</div></form>';
  }
  function financeScreen() {
    const view = state.screen.replace('finance-', '');
    const summary = finance();
    const balances = paymentBalances();
    if (state.editExpense) {
      const item = data.expenses.find(expense => String(expense.id) === String(state.editExpense));
      return '<section class="screen active">' + heading('Financeiro', 'Editar conta paga', 'Altere todos os dados de uma vez.') + (item ? expenseForm(item) : empty('Conta não encontrada.')) + '</section>';
    }
    if (view === 'receivable') {
      const cards = data.orders.filter(order => order.status === 'confirmed').sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate))).map(order => detail(order.customer, 'Vence em ' + brDate(order.dueDate) + ' · ' + esc(order.paymentMethod), money(order.total), 'pendente', '<div class="details-actions"><button class="primary" data-action="mark-paid" data-id="' + esc(order.id) + '">Marcar como pago</button><button class="outline" data-action="edit-order" data-id="' + esc(order.id) + '">Abrir pedido</button></div>')).join('') || empty('Nenhum pedido aguardando pagamento.');
      return '<section class="screen active">' + heading('Financeiro', 'Contas a receber', 'Pedidos confirmados que só entram no faturamento depois do pagamento.') + '<div class="list">' + cards + '</div></section>';
    }
    if (view === 'payable') {
      const cards = data.expenses.slice().sort((a, b) => String(b.date).localeCompare(String(a.date))).map(item => {
        const action = item.category === 'purchase' ? '<p class="form-note">Esta compra é corrigida pelo item de estoque.</p>' : '<div class="details-actions"><button class="outline" data-action="edit-expense" data-id="' + esc(item.id) + '">Editar</button><button class="outline danger-button" data-action="delete-expense" data-id="' + esc(item.id) + '">Excluir</button></div>';
        return detail(item.name, brDate(item.date) + ' · ' + esc(item.paymentMethod), '− ' + money(item.total), item.category === 'purchase' ? 'compra' : 'paga', '<dl><dt>Data</dt><dd>' + brDate(item.date) + '</dd><dt>Pago com</dt><dd>' + esc(item.paymentMethod) + '</dd></dl>' + action);
      }).join('') || empty('Nenhuma conta paga registrada.');
      return '<section class="screen active">' + heading('Financeiro', 'Contas pagas', 'Registre despesas operacionais. As compras de estoque entram automaticamente.') + expenseForm() + '<div class="list">' + cards + '</div></section>';
    }
    return '<section class="screen active">' + heading('Financeiro', 'Visão financeira', 'Cada cartão leva para a parte correspondente.') + '<div class="dashboard-grid finance-metrics">' +
      metric('Faturamento', 'financeRevenue', 'Pedidos pagos', 'reports:finance') +
      metric('Custo vendido', 'financeCost', 'Produtos dos pedidos pagos', 'reports:finance') +
      metric('Despesas operacionais', 'financeExpense', 'Contas pagas', 'finance:payable') +
      metric('Lucro real', 'financeProfit', 'Receita − custo − despesas', 'reports:finance', true) +
      '</div><section class="panel balance-panel"><h2>Saldo por forma de pagamento</h2><div class="payment-balances"><span>Dinheiro <b>' + money(balances.Dinheiro) + '</b></span><span>Pix / conta <b>' + money(balances.Pix) + '</b></span><span>Crédito <b>' + money(balances.Crédito) + '</b></span><span>Débito <b>' + money(balances.Débito) + '</b></span></div></section><section class="panel"><p class="form-note">Resultado atual: faturamento ' + money(summary.revenue) + ' − custo vendido ' + money(summary.cost) + ' − despesas operacionais ' + money(summary.expense) + '.</p></section></section>';
  }
  function reportRows(kind) {
    const query = String(state.reportFilter.query || '').toLocaleLowerCase('pt-BR');
    const min = n(state.reportFilter.min);
    const max = String(state.reportFilter.max || '').trim() ? n(state.reportFilter.max) : Infinity;
    const matches = row => {
      if (state.reportFilter.start && row.date < state.reportFilter.start) return false;
      if (state.reportFilter.end && row.date > state.reportFilter.end) return false;
      if (n(row.value) < min || n(row.value) > max) return false;
      if (state.reportFilter.payment && row.payment !== state.reportFilter.payment) return false;
      if (state.reportFilter.status && row.status !== state.reportFilter.status) return false;
      return !query || String(row.search || '').toLocaleLowerCase('pt-BR').includes(query);
    };
    let rows = [];
    if (kind === 'orders') rows = data.orders.map(order => ({ date: day(order.date), name: order.customer, items: order.items.map(line => line.productName).join(', '), payment: order.paymentMethod, status: orderStatus(order), value: n(order.total), search: order.customer + ' ' + order.items.map(line => line.productName).join(' ') }));
    if (kind === 'finance') rows = data.orders.filter(order => order.status === 'paid').map(order => ({ date: day(order.paidAt || order.date), name: order.customer, type: 'Entrada', payment: order.paymentMethod, status: 'pago', value: n(order.total), cost: n(order.cost), search: order.customer + ' ' + order.items.map(line => line.productName).join(' ') })).concat(data.expenses.map(item => ({ date: day(item.date), name: item.name, type: 'Saída', payment: item.paymentMethod, status: item.category === 'purchase' ? 'compra' : 'paga', value: -n(item.total), cost: 0, search: item.name })));
    if (kind === 'stock') {
      data.supplies.forEach(item => item.movements.forEach(move => rows.push({ date: day(move.date), name: item.name, type: move.kind, quantity: n(move.quantity), unit: item.unit, payment: move.paymentMethod || '', status: '', value: n(move.total), search: item.name + ' ' + move.kind })));
      data.readyStock.forEach(item => item.movements.forEach(move => rows.push({ date: day(move.date), name: item.name, type: move.kind, quantity: n(move.quantity), unit: 'un.', payment: '', status: '', value: 0, search: item.name + ' ' + move.kind })));
    }
    return rows.filter(matches).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  }
  function reportCard(row, kind) {
    if (kind === 'orders') return detail(row.name, brDate(row.date) + ' · ' + esc(row.payment), money(row.value), row.status, '<p>' + esc(row.items) + '</p>');
    if (kind === 'finance') return detail(row.name, brDate(row.date) + ' · ' + esc(row.payment), (row.value < 0 ? '− ' : '+ ') + money(Math.abs(row.value)), row.type.toLocaleLowerCase('pt-BR'), '<p>' + esc(row.type) + '</p>');
    return detail(row.name, brDate(row.date) + ' · ' + esc(row.type), (row.quantity >= 0 ? '+ ' : '− ') + Math.abs(row.quantity) + ' ' + esc(row.unit), 'estoque', '<p>Valor lançado: ' + money(row.value) + '</p>');
  }
  function reportsScreen() {
    const kind = state.screen.replace('reports-', '');
    const rows = reportRows(kind);
    let totalText = '', headings = [];
    if (kind === 'orders') {
      totalText = 'Pedidos: <b>' + rows.length + '</b> · valor: <b>' + money(rows.reduce((sum, row) => sum + row.value, 0)) + '</b> · recebidos: <b>' + money(rows.filter(row => row.status === 'pago').reduce((sum, row) => sum + row.value, 0)) + '</b>';
      headings = ['Data', 'Cliente', 'Itens', 'Pagamento', 'Situação', 'Valor'];
    } else if (kind === 'finance') {
      const inValue = rows.filter(row => row.value > 0).reduce((sum, row) => sum + row.value, 0);
      const outValue = rows.filter(row => row.value < 0).reduce((sum, row) => sum + Math.abs(row.value), 0);
      totalText = 'Entradas: <b>' + money(inValue) + '</b> · saídas: <b>' + money(outValue) + '</b>';
      headings = ['Data', 'Descrição', 'Tipo', 'Pagamento', 'Valor'];
    } else {
      totalText = 'Movimentações: <b>' + rows.length + '</b>';
      headings = ['Data', 'Item', 'Movimento', 'Quantidade', 'Valor'];
    }
    state.exportRows = rows;
    state.exportHeadings = headings;
    const title = kind === 'orders' ? 'Relatório de pedidos' : kind === 'finance' ? 'Relatório financeiro' : 'Relatório de estoque';
    const rank = kind === 'orders' && state.reportRanking ? '<section class="panel ranking-panel"><h2>Sabores mais vendidos ' + (state.reportRanking === 'week' ? 'na semana' : state.reportRanking === 'month' ? 'no mês' : 'no geral') + '</h2>' + bestCard('Ranking', bestSellers(order => !state.reportFilter.start || day(order.paidAt || order.date) >= state.reportFilter.start), 'reports:orders:' + state.reportRanking) + '</section>' : '';
    const f = state.reportFilter;
    return '<section class="screen active">' + heading('Relatórios', title, 'Filtre por data, valor, cliente, sabor, pagamento ou situação e baixe o resultado em Excel.') + rank + '<div class="panel filters">' +
      field('De', '<input data-filter="start" type="date" value="' + esc(f.start) + '">') +
      field('Até', '<input data-filter="end" type="date" value="' + esc(f.end) + '">') +
      field('Valor mínimo', '<input data-filter="min" inputmode="decimal" value="' + esc(f.min) + '">') +
      field('Valor máximo', '<input data-filter="max" inputmode="decimal" value="' + esc(f.max) + '">') +
      field('Pagamento', '<select data-filter="payment"><option value="">Todos</option>' + METHODS.map(method => '<option' + (f.payment === method ? ' selected' : '') + '>' + method + '</option>').join('') + '</select>') +
      field('Situação', '<select data-filter="status"><option value="">Todas</option><option value="pendente"' + (f.status === 'pendente' ? ' selected' : '') + '>Pendente</option><option value="pago"' + (f.status === 'pago' ? ' selected' : '') + '>Pago</option><option value="cancelado"' + (f.status === 'cancelado' ? ' selected' : '') + '>Cancelado</option></select>') +
      field('Buscar', '<input class="filter-search" data-filter="query" value="' + esc(f.query) + '" placeholder="Cliente, sabor, fornecedor...">') +
      '<button class="outline" type="button" data-action="clear-filter">Limpar</button><button class="secondary" type="button" data-action="export-xlsx">Baixar Excel</button></div><div class="panel report-summary">' + totalText + '</div><div class="list">' + (rows.map(row => reportCard(row, kind)).join('') || empty('Nenhum resultado encontrado.')) + '</div></section>';
  }
  function catalogScreen() {
    const cards = data.recipes.slice().sort((a, b) => a.name.localeCompare(b.name)).map(recipe => {
      const product = ready()[recipe.id];
      const quantity = product ? round(product.quantity) : 0;
      const source = product ? 'Em estoque: ' + quantity + ' un.' : 'Ainda não foi produzido';
      const photo = recipe.imageData ? '<div class="customer-preview"><img src="' + esc(recipe.imageData) + '" alt=""></div>' : '';
      return detail(recipe.name, source, money(recipe.saleUnitPrice), recipe.active === false ? 'oculto' : 'ativo', '<p>' + esc(recipe.description || 'Sem descrição para o cliente.').replace(/\n/g, '<br>') + '</p>' + photo + '<p class="form-note">Este é o mesmo sabor que poderá aparecer no cardápio do cliente: precisa estar ativo e ter estoque produzido.</p><div class="details-actions"><button class="outline" data-action="edit-recipe" data-id="' + esc(recipe.id) + '">Editar sabor</button><button class="secondary" data-action="toggle-catalog" data-id="' + esc(recipe.id) + '">' + (recipe.active === false ? 'Mostrar no cardápio' : 'Ocultar do cardápio') + '</button><button class="outline danger-button" data-action="delete-recipe" data-id="' + esc(recipe.id) + '">Excluir receita</button></div>');
    }).join('') || empty('Ainda não há sabores cadastrados.');
    return '<section class="screen active">' + heading('Cadastros', 'Cardápio e sabores', 'Cadastre ou edite aqui os sabores que podem ser produzidos. Este é o cardápio usado pelo link do cliente.') + '<div class="isolated-actions"><button class="primary" data-action="new-recipe">Cadastrar novo sabor</button><button class="secondary" data-action="copy-catalog-link">Gerar link para o cliente</button></div><section class="panel"><p class="form-note">Para aparecer ao cliente, o sabor precisa estar marcado como disponível e ter quantidade no Estoque produzido.</p></section><div class="list">' + cards + '</div></section>';
  }
  function supplierScreen() {
    const cards = data.suppliers.slice().sort((a, b) => a.name.localeCompare(b.name)).map(item => detail(item.name, esc(item.note || 'Sem observação'), '', 'fornecedor', '<div class="details-actions"><button class="outline" data-action="edit-supplier" data-id="' + esc(item.id) + '">Editar</button><button class="outline danger-button" data-action="delete-supplier" data-id="' + esc(item.id) + '">Excluir</button></div>')).join('') || empty('Nenhum fornecedor cadastrado.');
    return '<section class="screen active">' + heading('Cadastros', 'Fornecedores', 'Cadastre onde você compra para identificar preços e últimas compras.') + '<form id="supplierForm" class="panel form-panel"><div class="form-grid two">' + field('Nome do fornecedor', '<input name="name" required placeholder="Ex.: Tenda">') + field('Contato / observação', '<input name="note" placeholder="Ex.: WhatsApp, bairro ou condição de compra">') + '</div><button class="primary full">Salvar fornecedor</button></form><div class="list">' + cards + '</div></section>';
  }
  function supplierEditScreen() {
    const item = data.suppliers.find(supplier => String(supplier.id) === String(state.editSupplier));
    if (!item) return '<section class="screen active">' + empty('Fornecedor não encontrado.') + '</section>';
    return '<section class="screen active">' + heading('Cadastros', 'Editar fornecedor', 'Altere todas as informações de uma vez.') + '<form id="supplierEditForm" class="panel form-panel"><input type="hidden" name="id" value="' + esc(item.id) + '"><div class="form-grid two">' + field('Nome do fornecedor', '<input name="name" required value="' + esc(item.name) + '">') + field('Contato / observação', '<input name="note" value="' + esc(item.note || '') + '">') + '</div><div class="button-row"><button class="primary">Salvar todas as alterações</button><button class="outline" type="button" data-route="records:suppliers">Cancelar</button><button class="outline danger-button" type="button" data-action="delete-supplier" data-id="' + esc(item.id) + '">Excluir</button></div></form></section>';
  }
  function toolsScreen() {
    if (state.screen === 'tools-capacity') {
      const recipe = recipeById()[state.capacityRecipe];
      let result = 'Escolha a receita para descobrir quantos lotes e geladinhos podem ser produzidos.';
      if (recipe) {
        try {
          const computed = window.GelatosCore.recipeCost(recipe, supplies());
          const capacities = computed.lines.map(line => ({ name: supplies()[line.supplyId].name, batches: Math.floor(n(supplies()[line.supplyId].quantity) / n(line.quantity)) }));
          const maxBatches = Math.max(0, Math.min(...capacities.map(item => item.batches)));
          result = '<strong>É possível fazer ' + maxBatches + ' lote(s), ou ' + round(maxBatches * n(recipe.yieldUnits)) + ' geladinhos.</strong><span>Item que limita: ' + esc(capacities.sort((a, b) => a.batches - b.batches)[0]?.name || '—') + '.</span>';
        } catch (error) { result = '<strong>Complete a receita primeiro.</strong><span>' + esc(error.message) + '</span>'; }
      }
      return '<section class="screen active">' + heading('Ferramentas', 'Produção possível', 'Veja o máximo que pode produzir com o estoque atual.') + '<form id="capacityForm" class="panel form-panel">' + field('Receita', '<select name="recipeId">' + options(data.recipes, state.capacityRecipe || '') + '</select>') + '<button class="primary full">Calcular produção possível</button></form><div class="capacity-result">' + result + '</div></section>';
    }
    const item = supplies()[state.compareSupply];
    const price = n(state.comparePrice);
    let result = 'Escolha um item e informe o preço encontrado no mercado.';
    if (item && price > 0) {
      const older = item.movements.filter(move => move.kind === 'Compra').slice(-12).map(move => n(move.unitPrice)).filter(Boolean);
      const lowest = older.length ? Math.min(...older) : n(item.averageUnitCost);
      result = '<strong>' + esc(item.name) + '</strong><span>Preço informado: ' + money(price) + ' / ' + esc(item.unit) + '</span><span>Melhor compra registrada: ' + money(lowest) + ' / ' + esc(item.unit) + '</span><b class="' + (price <= lowest ? 'good' : 'warn') + '">' + (price <= lowest ? 'Vale a pena comprar por este preço.' : 'Está mais caro que a melhor compra registrada.') + '</b>';
    }
    return '<section class="screen active">' + heading('Ferramentas', 'Comparar preço', 'Compare o preço visto no mercado com suas compras registradas.') + '<form id="compareForm" class="panel form-panel"><div class="form-grid two">' + field('Item', '<select name="supplyId">' + options(data.supplies, state.compareSupply || '') + '</select>') + field('Preço visto (R$)', '<input name="unitPrice" inputmode="decimal" value="' + esc(state.comparePrice || '') + '">', 'Preço de uma unidade na mesma unidade cadastrada no estoque.') + '</div><button class="primary full">Comparar preço</button></form><div class="comparison-result">' + result + '</div></section>';
  }
  function settingsScreen() {
    const section = state.screen.replace('settings-', '');
    if (section === 'cloud') {
      const signedIn = window.GelatosCloud?.hasSession();
      const synced = cloudRevision !== null;
      if (!signedIn) return '<section class="screen active">' + heading('Bem-vinda de volta', 'Entre para carregar sua empresa', 'Como este é um novo endereço do aplicativo, entre uma vez com o mesmo acesso usado anteriormente. Seus pedidos, estoque e financeiro continuam guardados na nuvem.') + '<form id="cloudAuthForm" class="panel form-panel"><h2>Acesso da Gelatos Lele</h2>' + field('E-mail usado no Gelatos Lele', '<input name="email" type="email" autocomplete="email" required placeholder="voce@exemplo.com">') + field('Senha do Gelatos Lele', '<input name="password" type="password" autocomplete="current-password" minlength="8" required>', 'Use a senha criada para entrar no Gelatos Lele. Não é a senha do GitHub ou do banco de dados.') + '<div class="button-row"><button class="primary" name="cloudMode" value="signin">Carregar minha empresa</button><button class="outline" name="cloudMode" value="signup">Criar acesso novo</button></div><p class="form-note">Use “Criar acesso novo” somente se sua empresa ainda não tinha sincronização. Após entrar, os dados cadastrados voltarão automaticamente.</p></form></section>';
      return '<section class="screen active">' + heading('Configurações', 'Nuvem e sincronização', synced ? 'Sua empresa está sincronizada. Alterações feitas em um celular aparecem no outro.' : 'Ative a empresa e envie os dados deste celular uma única vez.') + '<section class="panel"><h2>Acesso conectado</h2><p>' + esc(window.GelatosCloud.email() || 'E-mail conectado') + '</p><span class="badge ' + (synced ? 'paid' : 'pending') + '">' + (synced ? 'sincronizado' : 'aguardando ativação') + '</span></section>' + (synced ? '<section class="panel"><p>Os dados ficam neste celular e na nuvem. Quando houver internet, alterações e pedidos do cardápio são atualizados automaticamente.</p><div class="button-row"><button class="secondary" data-action="cloud-refresh">Atualizar agora</button><button class="outline" data-action="cloud-signout">Sair deste celular</button></div></section>' : '<form id="cloudActivateForm" class="panel form-panel"><h2>Ativar e migrar os dados</h2>' + field('Código de ativação', '<input name="activationCode" required autocomplete="off" placeholder="Código recebido no atendimento">', 'Use o código único fornecido para esta primeira ativação. Depois dele, só quem entrar com seu e-mail e senha terá acesso.') + '<button class="primary full">Ativar empresa e enviar dados deste celular</button><p class="form-note">Faça isto no celular que já tem os cadastros corretos. Os dados atuais não serão apagados.</p></form>') + '</section>';
    }
    if (section === 'appearance') {
      return '<section class="screen active">' + heading('Configurações', 'Logo do app', 'Troque separadamente a logo da tela inicial e a logo do cabeçalho.') + '<form id="appearanceForm" class="panel form-panel">' +
        field('Logo inicial do app', '<input name="homeLogo" type="file" accept="image/*">', 'Aparece centralizada na tela inicial. Se não escolher arquivo, a marca atual será mantida.') +
        '<p class="form-note">A imagem padrão não possui fundo. Use preferencialmente um PNG com fundo transparente.</p>' +
        field('Logo do cabeçalho e menu', '<input name="headerLogo" type="file" accept="image/*">', 'Aparece no alto do app e no menu lateral.') +
        '<div class="button-row"><button class="primary">Salvar logos</button><button class="outline" type="button" data-action="restore-default-logos">Usar logo padrão</button></div></form></section>';
    }
    if (section === 'message') {
      return '<section class="screen active">' + heading('Configurações', 'Mensagem e Pix', 'Personalize a confirmação enviada depois que um pedido é criado.') + '<form id="messageForm" class="panel form-panel">' +
        field('Chave Pix', '<input name="pixKey" value="' + esc(data.settings.pixKey) + '" placeholder="Telefone, e-mail ou chave aleatória">', 'Será incluída no final da mensagem de confirmação.') +
        field('Mensagem do WhatsApp', '<textarea name="whatsappTemplate" rows="9">' + esc(data.settings.whatsappTemplate) + '</textarea>', 'Campos que você pode usar: {nome}, {itens}, {total} e {pix}. Em pedido de um sabor, {itens} mostra somente quantidade e sabor; em pedidos com mais sabores, mostra também o total de cada linha.') +
        '<section class="message-fields"><h2>Campos disponíveis</h2><button type="button" data-action="info" data-info-title="Campo {nome}" data-info-text="Nome do cliente informado no pedido.">{nome}</button><button type="button" data-action="info" data-info-title="Campo {itens}" data-info-text="Lista dos sabores e quantidades. Em pedido com mais de um sabor, inclui o total de cada linha.">{itens}</button><button type="button" data-action="info" data-info-title="Campo {total}" data-info-text="Valor total de todo o pedido.">{total}</button><button type="button" data-action="info" data-info-title="Campo {pix}" data-info-text="Chave Pix cadastrada nesta tela.">{pix}</button></section><button class="primary full">Salvar mensagem</button></form></section>';
    }
    if (section === 'catalog') {
      const link = catalogLink();
      return '<section class="screen active">' + heading('Configurações', 'Cardápio do cliente', 'Configure as informações do link que mostra os sabores cadastrados em Cadastros › Cardápio / sabores.') + '<form id="catalogSettingsForm" class="panel form-panel">' +
        field('Texto de apresentação', '<textarea name="catalogIntro" rows="3">' + esc(data.settings.catalogIntro || '') + '</textarea>', 'O cliente lê este texto ao abrir o cardápio.') +
        field('WhatsApp da empresa', '<input name="catalogPhone" inputmode="tel" value="' + esc(data.settings.catalogPhone || '') + '">', 'É usado se o celular não tiver a opção de compartilhar disponível.') +
        field('Endereço / instruções', '<textarea name="businessAddress" rows="3">' + esc(data.settings.businessAddress || '') + '</textarea>', 'Ex.: retirada no endereço, horário ou taxa de entrega.') +
        '<button class="primary full">Salvar informações do cardápio</button></form><section class="panel"><h2>Link para enviar ao cliente</h2><p>O link mostra somente os sabores ativos cadastrados no Cardápio que têm estoque produzido.</p><div class="customer-link"><input readonly value="' + esc(link) + '"><button class="secondary" type="button" data-action="copy-catalog-link">Copiar link</button></div><p class="form-note">Com a nuvem ativada, o pedido do cliente entra diretamente nos pedidos e reserva o estoque na mesma hora.</p></section></section>';
    }
    if (section === 'delivery') {
      return '<section class="screen active">' + heading('Configurações', 'Frete e entrega', 'Crie os locais de entrega e o respectivo frete. O cliente escolhe um local no cardápio e o total é calculado na hora.') + '<form id="deliverySettingsForm" class="panel form-panel">' +
        field('Formas de receber', '<input name="deliveryModes" value="' + esc(data.settings.deliveryModes || 'Retirada,Entrega') + '">', 'Separe as opções por vírgula. Ex.: Retirada,Entrega.') +
        field('Endereço para retirada', '<textarea name="pickupAddress" rows="3" placeholder="Ex.: Rua das Flores, 123 — Centro">' + esc(data.settings.pickupAddress || '') + '</textarea>', 'Aparece ao cliente somente quando ele escolher Retirada. Inclua endereço, horário e ponto de referência se desejar.') +
        field('Locais e taxas de frete', '<textarea name="deliveryZones" rows="7" placeholder="Centro | 5,00&#10;Jardim das Flores | 7,00&#10;Bairro Novo | 10,00">' + esc(data.settings.deliveryZones || '') + '</textarea>', 'Uma linha por local. Escreva o nome do local, depois a barra vertical | e o valor do frete. Ex.: Centro | 5,00.') +
        field('Frete grátis acima de valor (R$)', '<input name="freeDeliveryMinValue" inputmode="decimal" value="' + esc(data.settings.freeDeliveryMinValue || '') + '" placeholder="Ex.: 50,00">', 'Deixe em branco se não quiser esta regra. O frete fica grátis quando o subtotal dos geladinhos atingir este valor.') +
        field('Frete grátis acima de quantidade', '<input name="freeDeliveryMinItems" inputmode="decimal" value="' + esc(data.settings.freeDeliveryMinItems || '') + '" placeholder="Ex.: 10">', 'Deixe em branco se não quiser esta regra. O frete fica grátis quando a quantidade total atingir este número.') +
        '<button class="primary full">Salvar frete e entrega</button></form><section class="panel"><h2>Como o cliente verá</h2><p>Ao escolher Entrega, ele seleciona o local e vê subtotal, frete e total antes de enviar o pedido.</p></section></section>';
    }
    if (section === 'backup') {
      return '<section class="screen active">' + heading('Configurações', 'Backup dos dados', 'Salve uma cópia antes de trocar de celular ou fazer alterações grandes.') + '<section class="panel"><p>O backup inclui receitas, estoque, compras, pedidos, financeiro e configurações.</p><div class="button-row"><button class="secondary" data-action="backup">Baixar backup</button><button class="outline" data-action="restore">Restaurar backup</button></div><input id="restoreFile" type="file" accept="application/json" hidden></section></section>';
    }
    return '<section class="screen active">' + heading('Configurações', 'Configurações', 'Cada assunto fica em sua própria tela para evitar campos fora do lugar.') + '<div class="settings-list"><button data-route="settings:cloud"><b>Nuvem e sincronização</b><span>Pedidos, estoque e financeiro em todos os celulares</span></button><button data-route="settings:appearance"><b>Logo do app</b><span>Logo inicial e cabeçalho</span></button><button data-route="settings:message"><b>Mensagem e Pix</b><span>Confirmação de pedido e campos disponíveis</span></button><button data-route="settings:catalog"><b>Cardápio do cliente</b><span>Link e informações para quem vai comprar</span></button><button data-route="settings:delivery"><b>Frete e entrega</b><span>Locais, taxas e regras de frete grátis</span></button><button data-route="settings:backup"><b>Backup</b><span>Salvar e restaurar dados</span></button></div></section>';
  }
  function deliveryZones(value) {
    return String(value || '').split(/\r?\n/).map(line => {
      const [name, ...feeParts] = line.split('|');
      const fee = n(feeParts.join('|'));
      return { id: String(name || '').trim().toLocaleLowerCase('pt-BR').replace(/[^a-z0-9]+/g, '-'), name: String(name || '').trim(), fee: Math.max(0, fee) };
    }).filter(zone => zone.name);
  }
  function catalogPayload() {
    return {
      brand: 'Gelatos Lele',
      intro: data.settings.catalogIntro || '',
      phone: data.settings.catalogPhone || '',
      address: data.settings.businessAddress || '',
      pickupAddress: data.settings.pickupAddress || '',
      deliveryModes: data.settings.deliveryModes || 'Retirada,Entrega',
      deliveryZones: deliveryZones(data.settings.deliveryZones),
      freeDeliveryMinValue: Math.max(0, n(data.settings.freeDeliveryMinValue)),
      freeDeliveryMinItems: Math.max(0, n(data.settings.freeDeliveryMinItems)),
      products: data.recipes.filter(recipe => recipe.active !== false && n(ready()[recipe.id]?.quantity) > 0).map(recipe => ({
        id: recipe.id,
        name: recipe.name,
        description: recipe.description || '',
        price: n(recipe.saleUnitPrice),
        available: n(ready()[recipe.id]?.quantity),
        image: recipe.imageData && recipe.imageData.length < 30000 ? recipe.imageData : ''
      }))
    };
  }
  function catalogLink() {
    try {
      if (cloudRevision !== null) return location.origin + location.pathname.replace(/[^/]*$/, '') + 'customer.html?v=26';
      const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(catalogPayload()))));
      return location.origin + location.pathname.replace(/[^/]*$/, '') + 'customer.html#c=' + encoded;
    } catch (_) {
      return 'Salve as configurações antes de gerar o link.';
    }
  }
  function noticesPanel() {
    if (!state.notices) return '';
    const rows = data.notifications.slice(0, 30).map(item => '<button class="notice-row ' + (item.read ? 'read' : '') + '" data-action="open-notice" data-id="' + esc(item.id) + '"><b>' + esc(item.title) + '</b><span>' + esc(item.body) + '</span><small>' + new Date(item.date).toLocaleString('pt-BR') + '</small></button>').join('') || empty('Nenhuma notificação no momento.');
    return '<aside class="notice-panel"><div class="section-line"><div><h2>Notificações</h2><p>Estoque mínimo e pagamentos pendentes.</p></div><button class="icon-button" data-action="close-notices" aria-label="Fechar notificações">×</button></div><button class="text-button" data-action="read-notices">Marcar todas como lidas</button><div class="notice-list">' + rows + '</div></aside>';
  }
  function infoPanel() {
    if (!state.info) return '';
    return '<div class="info-overlay" data-action="close-info"><section class="info-dialog" role="dialog" aria-modal="true" aria-label="' + esc(state.info.title) + '"><button class="icon-button" data-action="close-info" aria-label="Fechar">×</button><h2>' + esc(state.info.title) + '</h2><p>' + esc(state.info.text) + '</p><button class="primary full" data-action="close-info">Entendi</button></section></div>';
  }
  function renderDashboard() {
    const paid = data.orders.filter(order => order.status === 'paid');
    const balances = paymentBalances();
    const now = new Date();
    const month = date => {
      const parsed = new Date(date + 'T12:00:00');
      return parsed.getMonth() === now.getMonth() && parsed.getFullYear() === now.getFullYear();
    };
    const paidMonth = paid.filter(order => month(day(order.paidAt || order.date)));
    const monthExpenses = data.expenses.filter(item => item.category !== 'purchase' && month(day(item.date)));
    const monthFinance = finance(paidMonth, monthExpenses);
    const set = (id, value) => { const node = $('#' + id); if (node) node.textContent = value; };
    set('dashReady', round(data.readyStock.reduce((sum, item) => sum + n(item.quantity), 0)) + ' un.');
    set('dashOrders', data.orders.filter(order => day(order.date) === today()).length);
    set('dashToday', money(paid.filter(order => day(order.paidAt || order.date) === today()).reduce((sum, order) => sum + n(order.total), 0)));
    set('dashMonth', money(monthFinance.revenue));
    set('dashYear', money(paid.filter(order => String(day(order.paidAt || order.date)).slice(0, 4) === String(now.getFullYear())).reduce((sum, order) => sum + n(order.total), 0)));
    set('dashProfit', money(monthFinance.profit));
    set('dashCash', money(balances.Dinheiro));
    set('dashPix', money(balances.Pix));
    set('dashCredit', money(balances.Crédito));
    set('dashDebit', money(balances.Débito));
    set('financeRevenue', money(finance().revenue));
    set('financeCost', money(finance().cost));
    set('financeExpense', money(finance().expense));
    set('financeProfit', money(finance().profit));
  }
  function render(options = {}) {
    const scrollTop = options.preserveScroll ? window.scrollY : 0;
    refreshNotices();
    saveLocal();
    rememberScreen();
    $('#app').innerHTML = shell();
    renderDashboard();
    if (!options.preserveScroll) {
      window.scrollTo({ top: 0, behavior: 'instant' });
      return;
    }
    requestAnimationFrame(() => {
      window.scrollTo({ top: scrollTop, behavior: 'instant' });
      const nextField = options.focusSelector ? $(options.focusSelector) : null;
      if (nextField) {
        nextField.focus({ preventScroll: true });
        nextField.scrollIntoView({ block: 'nearest', behavior: 'instant' });
      }
    });
  }
  function orderLines() {
    const grouped = {};
    state.orderLines.forEach(line => {
      if (line.productId && n(line.quantity) > 0) grouped[line.productId] = round((grouped[line.productId] || 0) + n(line.quantity));
    });
    return Object.entries(grouped).map(([productId, quantity]) => ({ productId, quantity, saleUnitPrice: n(ready()[productId]?.saleUnitPrice) }));
  }
  function reserveOrder(lines, date, kind) {
    const result = window.GelatosCore.validateOrder(lines, ready());
    result.lines.forEach(line => {
      const product = ready()[line.productId];
      product.quantity = round(n(product.quantity) - n(line.quantity));
      product.movements.push({ id: uid(), kind, quantity: -n(line.quantity), date });
    });
    return result;
  }
  function returnOrder(order, date, kind) {
    order.items.forEach(line => {
      const product = ready()[line.productId];
      if (!product) return;
      product.quantity = round(n(product.quantity) + n(line.quantity));
      product.movements.push({ id: uid(), kind, quantity: n(line.quantity), date });
    });
  }
  async function submitOrder(form, editing = false) {
    if (orderSubmitting) return;
    orderSubmitting = true;
    try {
    const f = form.elements;
    const customer = f.customer.value.trim();
    let lines = orderLines();
    if (!customer || !lines.length) {
      toast('Informe o cliente e pelo menos um geladinho.');
      return;
    }
    rememberOrderDraft();
    if (!await confirmLatestStock()) return;
    lines = orderLines();
    const date = f.date.value || today();
    if (!editing) {
      try {
        const result = reserveOrder(lines, date, 'Pedido confirmado');
        data.orders.unshift({ id: uid(), customer, phone: f.phone.value.trim(), items: result.lines.map(line => ({ ...line, picked: false })), total: result.revenue, cost: result.cost, profit: result.profit, paymentMethod: f.payment.value, status: 'confirmed', date, dueDate: f.dueDate.value || date, paidAt: '' });
        state.orderLines = [{ productId: '', quantity: 1 }];
        state.orderDraft = null;
        addNotice('order', 'Pedido confirmado: ' + customer, 'Total de ' + money(result.revenue) + ' aguardando pagamento.', 'orders-history');
        save();
        toast('Pedido confirmado e estoque reservado.');
        navigate('orders:history');
      } catch (error) { toast(error.message); }
      return;
    }
    const old = data.orders.find(order => String(order.id) === String(control(form, 'id').value));
    if (!old) return;
    const snapshot = JSON.stringify(data.readyStock);
    try {
      if (old.status !== 'cancelled') returnOrder(old, date, 'Estorno para edição');
      const result = reserveOrder(lines, date, 'Pedido editado');
      Object.assign(old, { customer, phone: f.phone.value.trim(), items: result.lines.map(line => ({ ...line, picked: false })), total: result.revenue, cost: result.cost, profit: result.profit, paymentMethod: f.payment.value, date, dueDate: f.dueDate.value || date, status: old.status === 'cancelled' ? 'confirmed' : old.status });
      state.editOrder = '';
      state.orderLines = [{ productId: '', quantity: 1 }];
      state.orderDraft = null;
      save();
      toast('Pedido atualizado e total recalculado.');
      navigate('orders:history');
    } catch (error) {
      data.readyStock = JSON.parse(snapshot);
      toast(error.message);
    }
    } finally {
      orderSubmitting = false;
    }
  }
  function savePurchase(form) {
    const f = form.elements;
    const quantity = n(f.quantity.value);
    const total = n(f.total.value);
    const selected = f.supplyId.value;
    const newName = f.newName.value.trim();
    if (!(quantity > 0) || !(total >= 0) || (!selected && !newName)) {
      toast('Informe o item, a quantidade e o total pago.');
      return;
    }
    let item = selected ? supplies()[selected] : null;
    if (!item) {
      item = { id: uid(), name: newName, category: f.category.value, unit: f.unit.value, quantity: 0, averageUnitCost: 0, minimumStock: Math.max(0, n(f.minimumStock.value)), movements: [] };
      data.supplies.push(item);
    }
    const date = f.date.value || today();
    const supplier = data.suppliers.find(entry => String(entry.id) === String(f.supplierId.value));
    const oldQuantity = n(item.quantity);
    const unitPrice = round(total / quantity);
    item.quantity = round(oldQuantity + quantity);
    item.averageUnitCost = round((oldQuantity * n(item.averageUnitCost) + total) / (oldQuantity + quantity));
    item.lastPurchaseAt = date;
    item.lastPurchaseTotal = total;
    item.lastSupplierName = supplier?.name || '';
    item.movements.push({ id: uid(), kind: 'Compra', quantity, total, date, supplierId: supplier?.id || '', supplierName: supplier?.name || '', unitPrice, paymentMethod: f.payment.value });
    const purchase = { id: uid(), supplyId: item.id, supplyName: item.name, supplierId: supplier?.id || '', supplierName: supplier?.name || '', quantity, unit: item.unit, total, unitPrice, date, paymentMethod: f.payment.value };
    data.purchases.unshift(purchase);
    data.expenses.unshift({ id: uid(), name: 'Compra: ' + item.name, total, paymentMethod: f.payment.value, date, category: 'purchase', supplyId: item.id, purchaseId: purchase.id });
    save();
    toast('Compra lançada. O custo médio foi atualizado.');
    navigate('stock:' + (item.category === 'supply' ? 'supply' : 'ingredient'));
  }
  function saveSupplyEdit(form) {
    const f = form.elements;
    const item = supplies()[control(form, 'id').value];
    if (!item || !control(form, 'name').value.trim() || !f.unit.value.trim()) {
      toast('Confira nome e unidade do item.');
      return;
    }
    const quantity = Math.max(0, n(f.quantity.value));
    const difference = round(quantity - n(item.quantity));
    if (difference) item.movements.push({ id: uid(), kind: 'Ajuste manual', quantity: difference, total: 0, date: today() });
    Object.assign(item, { name: control(form, 'name').value.trim(), category: f.category.value, unit: f.unit.value.trim(), quantity, averageUnitCost: Math.max(0, n(f.averageUnitCost.value)), minimumStock: Math.max(0, n(f.minimumStock.value)), lastPurchaseAt: f.lastPurchaseAt.value, lastSupplierName: f.lastSupplierName.value.trim() });
    state.editSupply = '';
    save();
    toast('Item atualizado.');
    navigate('stock:' + (item.category === 'supply' ? 'supply' : 'ingredient'));
  }
  function saveReadyEdit(form) {
    const f = form.elements;
    const item = ready()[f.recipeId.value];
    if (!item) return;
    const quantity = Math.max(0, n(f.quantity.value));
    const difference = round(quantity - n(item.quantity));
    if (difference) item.movements.push({ id: uid(), kind: 'Ajuste manual', quantity: difference, date: today() });
    Object.assign(item, { quantity, unitCost: Math.max(0, n(f.unitCost.value)), saleUnitPrice: Math.max(0, n(f.saleUnitPrice.value)), minimumStock: Math.max(0, n(f.minimumStock.value)) });
    state.editReady = '';
    save();
    toast('Estoque produzido atualizado.');
    navigate('stock:ready');
  }
  function saveRecipe(form) {
    const f = form.elements;
    const items = state.recipeLines.map(line => ({ supplyId: line.supplyId, quantity: n(line.quantity), unit: String(line.unit || '').trim() })).filter(line => line.supplyId && line.quantity > 0 && line.unit);
    if (!control(form, 'name').value.trim() || !(n(f.yieldUnits.value) > 0) || !(n(f.saleUnitPrice.value) >= 0) || !items.length) {
      toast('Preencha nome, rendimento, preço e pelo menos um ingrediente ou embalagem.');
      return;
    }
    const recipeId = control(form, 'id').value;
    const old = recipeId ? recipeById()[recipeId] : null;
    const write = imageData => {
      const recipe = {
        id: recipeId || uid(),
        name: control(form, 'name').value.trim(),
        yieldUnits: n(f.yieldUnits.value),
        saleUnitPrice: n(f.saleUnitPrice.value),
        laborAmount: Math.max(0, n(f.laborAmount.value)),
        laborMode: f.laborMode.value === 'unit' ? 'unit' : 'batch',
        description: f.description.value.trim(),
        preparation: f.preparation.value.trim(),
        imageData: imageData || old?.imageData || '',
        active: f.active.checked,
        items
      };
      const index = data.recipes.findIndex(item => String(item.id) === String(recipe.id));
      if (index >= 0) data.recipes.splice(index, 1, recipe);
      else data.recipes.push(recipe);
      state.editRecipe = '';
      state.recipeLinesLoaded = false;
      state.recipeLines = [{ supplyId: '', quantity: '', unit: '' }];
      state.recipeDraft = null;
      save();
      toast('Receita salva com materiais e mão de obra.');
      navigate('records:catalog');
    };
    const image = f.image.files[0];
    if (!image) {
      write('');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => write(reader.result);
    reader.onerror = () => toast('Não foi possível ler a imagem. Tente uma imagem menor.');
    reader.readAsDataURL(image);
  }
  function saveProduction(form) {
    const f = form.elements;
    const recipe = recipeById()[f.recipeId.value];
    const batches = n(f.batches.value);
    if (!recipe || !(batches > 0)) {
      toast('Selecione a receita e informe os lotes.');
      return;
    }
    try {
      const result = createProduction(recipe, batches, f.date.value || today());
      data.productions.unshift({ id: uid(), recipeId: recipe.id, recipeName: recipe.name, batches, outputQuantity: result.outputQuantity, totalCost: result.totalCost, unitCost: result.unitCost, consumed: result.consumed, date: f.date.value || today() });
      save();
      toast('Produção registrada e estoque atualizado.');
      render();
    } catch (error) {
      toast(error.message);
    }
  }
  function saveProductionEdit(form) {
    const f = form.elements;
    const old = data.productions.find(item => String(item.id) === String(control(form, 'id').value));
    const recipe = old && recipeById()[old.recipeId];
    const batches = n(f.batches.value);
    if (!old || !recipe || !(batches > 0)) {
      toast('Confira a produção.');
      return;
    }
    const snapshot = JSON.stringify({ supplies: data.supplies, readyStock: data.readyStock });
    try {
      reverseProduction(old);
      const result = createProduction(recipe, batches, f.date.value || today(), true);
      Object.assign(old, { batches, date: f.date.value || today(), outputQuantity: result.outputQuantity, totalCost: result.totalCost, unitCost: result.unitCost, consumed: result.consumed });
      state.editProduction = '';
      save();
      toast('Produção corrigida.');
      navigate('production');
    } catch (error) {
      const restore = JSON.parse(snapshot);
      data.supplies = restore.supplies;
      data.readyStock = restore.readyStock;
      toast(error.message);
    }
  }
  function saveManualReady(form) {
    const f = form.elements;
    const recipe = recipeById()[f.recipeId.value];
    const quantity = n(f.quantity.value);
    if (!recipe || !(quantity > 0)) {
      toast('Selecione uma receita e informe a quantidade.');
      return;
    }
    let unitCost = n(f.unitCost.value);
    if (!String(f.unitCost.value || '').trim()) {
      try { unitCost = fullRecipeCost(recipe).unitCost; }
      catch (_) { toast('Complete os custos da receita ou informe o custo por unidade.'); return; }
    }
    const date = f.date.value || today();
    let product = ready()[recipe.id];
    if (product) {
      const oldQuantity = n(product.quantity);
      product.unitCost = round((oldQuantity * n(product.unitCost) + quantity * unitCost) / (oldQuantity + quantity));
      product.quantity = round(oldQuantity + quantity);
      product.saleUnitPrice = n(recipe.saleUnitPrice);
      product.minimumStock = n(f.minimumStock.value) || n(product.minimumStock);
      product.movements.push({ id: uid(), kind: 'Cadastro manual', quantity, date });
    } else {
      product = { id: uid(), recipeId: recipe.id, name: recipe.name, quantity, unitCost, saleUnitPrice: n(recipe.saleUnitPrice), minimumStock: Math.max(0, n(f.minimumStock.value)), movements: [{ id: uid(), kind: 'Cadastro manual', quantity, date }] };
      data.readyStock.push(product);
    }
    save();
    toast('Estoque produzido registrado.');
    navigate('stock:ready');
  }
  function saveExpense(form, editing = false) {
    const f = form.elements;
    if (!control(form, 'name').value.trim() || !(n(f.total.value) > 0)) {
      toast('Informe a descrição e o valor.');
      return;
    }
    if (editing) {
      const item = data.expenses.find(expense => String(expense.id) === String(control(form, 'id').value));
      if (!item) return;
      Object.assign(item, { name: control(form, 'name').value.trim(), total: n(f.total.value), paymentMethod: f.payment.value, date: f.date.value || today() });
      state.editExpense = '';
      toast('Conta paga atualizada.');
    } else {
      data.expenses.unshift({ id: uid(), name: control(form, 'name').value.trim(), total: n(f.total.value), paymentMethod: f.payment.value, date: f.date.value || today(), category: 'operational' });
      toast('Conta paga registrada.');
    }
    save();
    navigate('finance:payable');
  }
  function saveSupplier(form, editing = false) {
    const f = form.elements;
    if (!control(form, 'name').value.trim()) {
      toast('Informe o nome do fornecedor.');
      return;
    }
    if (editing) {
      const item = data.suppliers.find(supplier => String(supplier.id) === String(control(form, 'id').value));
      if (!item) return;
      Object.assign(item, { name: control(form, 'name').value.trim(), note: f.note.value.trim() });
      state.editSupplier = '';
      toast('Fornecedor atualizado.');
    } else {
      data.suppliers.push({ id: uid(), name: control(form, 'name').value.trim(), note: f.note.value.trim() });
      toast('Fornecedor cadastrado.');
    }
    save();
    navigate('records:suppliers');
  }
  function saveMessage(form) {
    data.settings.pixKey = form.elements.pixKey.value.trim();
    data.settings.whatsappTemplate = form.elements.whatsappTemplate.value.trim() || DEFAULT_SETTINGS.whatsappTemplate;
    save();
    toast('Mensagem e Pix atualizados.');
    navigate('settings:home');
  }
  function saveCatalogSettings(form) {
    const f = form.elements;
    Object.assign(data.settings, { catalogIntro: f.catalogIntro.value.trim(), catalogPhone: f.catalogPhone.value.trim(), businessAddress: f.businessAddress.value.trim() });
    save();
    toast('Informações do cardápio atualizadas.');
    navigate('settings:catalog');
  }
  function saveDeliverySettings(form) {
    const f = form.elements;
    const zones = deliveryZones(f.deliveryZones.value);
    if (String(f.deliveryModes.value || '').toLocaleLowerCase('pt-BR').includes('entrega') && !zones.length) {
      toast('Cadastre pelo menos um local e sua taxa de frete para usar Entrega.');
      return;
    }
    Object.assign(data.settings, {
      deliveryModes: f.deliveryModes.value.trim() || 'Retirada,Entrega',
      pickupAddress: f.pickupAddress.value.trim(),
      deliveryZones: f.deliveryZones.value.trim(),
      freeDeliveryMinValue: f.freeDeliveryMinValue.value.trim(),
      freeDeliveryMinItems: f.freeDeliveryMinItems.value.trim()
    });
    save();
    toast('Frete e opções de entrega atualizados.');
    navigate('settings:delivery');
  }
  function saveAppearance(form) {
    const f = form.elements;
    const files = [{ file: f.homeLogo.files[0], key: 'homeLogoDataUrl' }, { file: f.headerLogo.files[0], key: 'headerLogoDataUrl' }].filter(item => item.file);
    if (!files.length) {
      toast('Escolha ao menos uma imagem para trocar a logo.');
      return;
    }
    let pending = files.length;
    files.forEach(item => {
      const reader = new FileReader();
      reader.onload = () => {
        data.settings[item.key] = reader.result;
        pending -= 1;
        if (!pending) {
          save();
          toast('Logo atualizada.');
          navigate('settings:appearance');
        }
      };
      reader.readAsDataURL(item.file);
    });
  }
  function markPaid(id) {
    const order = data.orders.find(item => String(item.id) === String(id));
    if (!order || order.status !== 'confirmed') return;
    order.status = 'paid';
    order.paidAt = today();
    addNotice('payment', 'Pagamento recebido: ' + order.customer, money(order.total) + ' entrou em ' + order.paymentMethod + '.', 'reports-finance');
    save();
    toast('Pagamento registrado. Esta venda agora entra no faturamento e lucro.');
    render();
  }
  function cancelOrder(id) {
    const order = data.orders.find(item => String(item.id) === String(id));
    if (!order || order.status === 'cancelled' || !confirm('Cancelar este pedido e devolver os geladinhos ao estoque?')) return;
    returnOrder(order, today(), 'Pedido cancelado');
    order.status = 'cancelled';
    save();
    toast('Pedido cancelado e estoque devolvido.');
    render();
  }
  function deleteOrder(id) {
    const order = data.orders.find(item => String(item.id) === String(id));
    if (!order || !confirm('Excluir este pedido?')) return;
    if (order.status !== 'cancelled') returnOrder(order, today(), 'Pedido excluído');
    data.orders = data.orders.filter(item => String(item.id) !== String(id));
    save();
    toast('Pedido excluído.');
    render();
  }
  function deleteSupply(id) {
    const item = supplies()[id];
    if (!item || !confirm('Excluir este cadastro?')) return;
    const linked = data.recipes.some(recipe => recipe.items.some(line => String(line.supplyId) === String(id))) || data.productions.some(production => (production.consumed || []).some(line => String(line.supplyId) === String(id)));
    if (linked) {
      toast('Não é possível excluir: o item já é usado em uma receita ou produção. Edite-o em vez disso.');
      return;
    }
    data.supplies = data.supplies.filter(entry => String(entry.id) !== String(id));
    data.purchases = data.purchases.filter(entry => String(entry.supplyId) !== String(id));
    data.expenses = data.expenses.filter(entry => String(entry.supplyId) !== String(id));
    save();
    toast('Cadastro excluído.');
    navigate('stock:ingredient');
  }
  function deleteReady(id) {
    const item = ready()[id];
    if (!item || !confirm('Excluir este cadastro de estoque produzido?')) return;
    if (n(item.quantity) !== 0 || data.orders.some(order => order.status !== 'cancelled' && order.items.some(line => String(line.productId) === String(id)))) {
      toast('Somente um cadastro vazio, sem pedido ativo, pode ser excluído.');
      return;
    }
    data.readyStock = data.readyStock.filter(entry => String(entry.recipeId) !== String(id));
    save();
    toast('Cadastro excluído.');
    navigate('stock:ready');
  }
  function deleteRecipe(id) {
    const recipe = recipeById()[id];
    if (!recipe || !confirm('Excluir esta receita?')) return;
    const linked = data.productions.some(item => String(item.recipeId) === String(id)) || data.readyStock.some(item => String(item.recipeId) === String(id)) || data.orders.some(order => order.items.some(line => String(line.productId) === String(id)));
    if (linked) {
      toast('Não é possível excluir: há produção, estoque ou pedido relacionado. Oculte o sabor do cardápio se não quiser mais vendê-lo.');
      return;
    }
    data.recipes = data.recipes.filter(item => String(item.id) !== String(id));
    save();
    toast('Receita excluída.');
    render();
  }
  function deleteProduction(id) {
    const production = data.productions.find(item => String(item.id) === String(id));
    if (!production || !confirm('Excluir esta produção?')) return;
    try {
      reverseProduction(production);
      data.productions = data.productions.filter(item => String(item.id) !== String(id));
      save();
      toast('Produção excluída e insumos devolvidos.');
      navigate('production');
    } catch (error) { toast(error.message); }
  }
  function deleteExpense(id) {
    const expense = data.expenses.find(item => String(item.id) === String(id));
    if (!expense || expense.category === 'purchase' || !confirm('Excluir esta conta paga?')) return;
    data.expenses = data.expenses.filter(item => String(item.id) !== String(id));
    state.editExpense = '';
    save();
    toast('Conta excluída.');
    navigate('finance:payable');
  }
  function deleteSupplier(id) {
    if (!data.suppliers.some(item => String(item.id) === String(id)) || !confirm('Excluir este fornecedor?')) return;
    data.suppliers = data.suppliers.filter(item => String(item.id) !== String(id));
    state.editSupplier = '';
    save();
    toast('Fornecedor excluído.');
    navigate('records:suppliers');
  }
  function sendOrder(id) {
    const order = data.orders.find(item => String(item.id) === String(id));
    if (!order) return;
    const lines = order.items.length === 1
      ? round(order.items[0].quantity) + '  ' + order.items[0].productName
      : order.items.map(line => round(line.quantity) + '  ' + line.productName + '  ' + money(line.total)).join('\n');
    const text = data.settings.whatsappTemplate
      .replace(/\{nome\}/g, order.customer)
      .replace(/\{itens\}/g, lines)
      .replace(/\{total\}/g, money(order.total))
      .replace(/\{pix\}/g, data.settings.pixKey || 'A combinar');
    if (navigator.share) {
      navigator.share({ title: 'Pedido Gelatos Lele', text }).catch(() => {});
      return;
    }
    const phone = String(order.phone || '').replace(/\D/g, '');
    const number = phone ? (phone.startsWith('55') ? phone : '55' + phone) : '';
    window.open('https://wa.me/' + number + '?text=' + encodeURIComponent(text), '_blank', 'noopener');
  }
  function backup() {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    downloadBlob(blob, 'backup-gelatos-lele-' + today() + '.json');
    toast('Backup baixado.');
  }
  function restore(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const imported = JSON.parse(reader.result);
        if (!Array.isArray(imported.supplies) || !Array.isArray(imported.recipes)) throw new Error();
        data = normalize(imported);
        save();
        toast('Backup restaurado neste aparelho.');
        navigate('home');
      } catch (_) { toast('Não foi possível restaurar este arquivo.'); }
    };
    reader.readAsText(file);
  }
  function copyCatalogLink() {
    const link = catalogLink();
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(link).then(() => toast('Link do cardápio copiado.')).catch(() => prompt('Copie este link para enviar ao cliente:', link));
    } else prompt('Copie este link para enviar ao cliente:', link);
  }
  async function authenticateCloud(form, mode) {
    const email = String(form.elements.email.value || '').trim();
    const password = String(form.elements.password.value || '');
    if (!email || password.length < 8) { toast('Informe seu e-mail e uma senha com pelo menos 8 caracteres.'); return; }
    try {
      if (mode === 'signup') {
        const result = await window.GelatosCloud.signUp(email, password);
        if (!result?.access_token) { toast('Acesse o e-mail de confirmação e depois volte aqui para entrar.'); return; }
        toast('Acesso criado. Agora ative a empresa.');
      } else {
        await window.GelatosCloud.signIn(email, password);
        toast('Acesso conectado.');
      }
      try {
        const remote = await window.GelatosCloud.getState();
        data = normalize(remote.state);
        cloudRevision = Number(remote.revision);
        saveLocal();
        toast('Dados da empresa carregados da nuvem.');
        navigate('home');
      } catch (_) { navigate('settings:cloud'); }
    } catch (error) { toast(error.message || 'Não foi possível entrar na nuvem.'); }
  }
  async function activateCloud(form) {
    const code = String(form.elements.activationCode.value || '').trim();
    if (!code) { toast('Informe o código de ativação.'); return; }
    try {
      const claimed = await window.GelatosCloud.claimStore(code);
      cloudRevision = Number(claimed.revision);
      const saved = await window.GelatosCloud.saveState(data, cloudRevision);
      cloudRevision = Number(saved.revision);
      saveLocal();
      toast('Empresa ativada e dados enviados para a nuvem.');
      navigate('home');
    } catch (error) { toast(error.message || 'Não foi possível ativar a empresa.'); }
  }
  async function forceCloudRefresh() {
    try {
      const remote = await window.GelatosCloud.getState();
      data = normalize(remote.state);
      cloudRevision = Number(remote.revision);
      saveLocal();
      render();
      toast('Dados atualizados pela nuvem.');
    } catch (error) { toast(error.message || 'Não foi possível atualizar agora.'); }
  }
  function downloadBlob(blob, name) {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1500);
  }
  function xmlText(value) { return esc(String(value ?? '')).replace(/\n/g, ' '); }
  function crc32(bytes) {
    let crc = 0 ^ -1;
    for (let i = 0; i < bytes.length; i += 1) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ bytes[i]) & 255];
    return (crc ^ -1) >>> 0;
  }
  const CRC_TABLE = (() => {
    const table = [];
    for (let i = 0; i < 256; i += 1) {
      let value = i;
      for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
      table[i] = value >>> 0;
    }
    return table;
  })();
  const u16 = value => [value & 255, (value >>> 8) & 255];
  const u32 = value => [value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255];
  function zip(files) {
    const encode = new TextEncoder();
    const parts = [], central = [];
    let offset = 0;
    files.forEach(file => {
      const name = encode.encode(file.name);
      const body = encode.encode(file.body);
      const crc = crc32(body);
      const local = new Uint8Array([...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(crc), ...u32(body.length), ...u32(body.length), ...u16(name.length), ...u16(0), ...name, ...body]);
      parts.push(local);
      central.push(new Uint8Array([...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(crc), ...u32(body.length), ...u32(body.length), ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset), ...name]));
      offset += local.length;
    });
    const centralSize = central.reduce((sum, part) => sum + part.length, 0);
    return new Blob([...parts, ...central, new Uint8Array([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(centralSize), ...u32(offset), ...u16(0)])], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }
  function exportXlsx() {
    const kind = state.screen.replace('reports-', '');
    const rows = state.exportRows || [];
    const contentRows = rows.map(row => kind === 'orders'
      ? [brDate(row.date), row.name, row.items, row.payment, row.status, row.value]
      : kind === 'finance'
        ? [brDate(row.date), row.name, row.type, row.payment, row.value]
        : [brDate(row.date), row.name, row.type, (row.quantity >= 0 ? '+ ' : '− ') + Math.abs(row.quantity) + ' ' + row.unit, row.value]);
    const all = [state.exportHeadings || [], ...contentRows];
    const cells = all.map((row, rowIndex) => '<row r="' + (rowIndex + 1) + '">' + row.map((value, column) => '<c r="' + String.fromCharCode(65 + column) + (rowIndex + 1) + '" t="' + (typeof value === 'number' ? 'n' : 'inlineStr') + '">' + (typeof value === 'number' ? '<v>' + value + '</v>' : '<is><t>' + xmlText(value) + '</t></is>') + '</c>').join('') + '</row>').join('');
    const sheet = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' + cells + '</sheetData></worksheet>';
    const types = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>';
    const rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>';
    const workbook = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Relatório" sheetId="1" r:id="rId1"/></sheets></workbook>';
    const workbookRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>';
    downloadBlob(zip([{ name: '[Content_Types].xml', body: types }, { name: '_rels/.rels', body: rels }, { name: 'xl/workbook.xml', body: workbook }, { name: 'xl/_rels/workbook.xml.rels', body: workbookRels }, { name: 'xl/worksheets/sheet1.xml', body: sheet }]), 'relatorio-gelatos-lele-' + kind + '-' + today() + '.xlsx');
    toast('Relatório Excel baixado.');
  }
  document.addEventListener('click', event => {
    const route = event.target.closest('[data-route]');
    if (route) {
      event.preventDefault();
      navigate(route.dataset.route);
      return;
    }
    const group = event.target.closest('[data-menu]');
    if (group) {
      state.menu = state.menu === group.dataset.menu ? '' : group.dataset.menu;
      render();
      return;
    }
    const actionNode = event.target.closest('[data-action]');
    if (!actionNode) {
      if (event.target.id === 'installCta' && deferredInstall) {
        deferredInstall.prompt();
        deferredInstall.userChoice.finally(() => { deferredInstall = null; $('#installCta')?.setAttribute('hidden', ''); });
      }
      return;
    }
    const action = actionNode.dataset.action;
    const id = actionNode.dataset.id;
    if (action === 'open-menu') { document.body.classList.add('drawer-open'); return; }
    if (action === 'close-menu') { document.body.classList.remove('drawer-open'); return; }
    if (action === 'open-notices') { state.notices = true; render(); return; }
    if (action === 'close-notices') { state.notices = false; render(); return; }
    if (action === 'read-notices') { data.notifications.forEach(item => item.read = true); save(); render(); return; }
    if (action === 'open-notice') {
      const notice = data.notifications.find(item => String(item.id) === String(id));
      if (notice) { notice.read = true; save(); navigate(notice.route || 'home'); }
      return;
    }
    if (action === 'info') { state.info = { title: actionNode.dataset.infoTitle || 'Informação', text: actionNode.dataset.infoText || '' }; render(); return; }
    if (action === 'close-info') { state.info = null; render(); return; }
    if (action === 'add-order-line') { rememberOrderDraft(); state.orderLines.push({ productId: '', quantity: 1 }); render(); return; }
    if (action === 'remove-order-line') { state.orderLines.splice(n(actionNode.dataset.index), 1); if (!state.orderLines.length) state.orderLines.push({ productId: '', quantity: 1 }); render(); return; }
    if (action === 'edit-order') {
      const order = data.orders.find(item => String(item.id) === String(id));
      if (order) { state.editOrder = id; state.orderLines = order.items.map(line => ({ productId: line.productId, quantity: line.quantity })); state.orderDraft = { customer: order.customer, phone: order.phone || '', payment: order.paymentMethod, date: order.date, dueDate: order.dueDate }; state.screen = 'order-edit'; render(); }
      return;
    }
    if (action === 'mark-paid') { markPaid(id); return; }
    if (action === 'cancel-order') { cancelOrder(id); return; }
    if (action === 'delete-order') { deleteOrder(id); return; }
    if (action === 'send-order') { sendOrder(id); return; }
    if (action === 'edit-supply') { state.editSupply = id; state.screen = 'supply-edit'; render(); return; }
    if (action === 'delete-supply') { deleteSupply(id); return; }
    if (action === 'edit-ready') { state.editReady = id; state.screen = 'ready-edit'; render(); return; }
    if (action === 'delete-ready') { deleteReady(id); return; }
    if (action === 'new-ready') { state.screen = 'stock-ready-manual'; render(); return; }
    if (action === 'add-recipe-line') { state.recipeDraft = recipeDraftFromScreen(); state.recipeLines.push({ supplyId: '', quantity: '', unit: '' }); render({ preserveScroll: true, focusSelector: '[data-recipe-supply="' + (state.recipeLines.length - 1) + '"]' }); return; }
    if (action === 'remove-recipe-line') { state.recipeLines.splice(n(actionNode.dataset.index), 1); if (!state.recipeLines.length) state.recipeLines.push({ supplyId: '', quantity: '', unit: '' }); state.recipeDraft = recipeDraftFromScreen(); render({ preserveScroll: true }); return; }
    if (action === 'new-recipe') { state.editRecipe = ''; state.recipeLinesLoaded = false; state.recipeLines = [{ supplyId: '', quantity: '', unit: '' }]; state.recipeDraft = null; navigate('recipes'); return; }
    if (action === 'edit-recipe') {
      const recipe = recipeById()[id];
      if (recipe) { state.editRecipe = id; state.recipeLines = recipe.items.map(line => ({ ...line })); state.recipeLinesLoaded = true; state.recipeDraft = { ...recipe }; navigate('recipes'); }
      return;
    }
    if (action === 'cancel-recipe-edit') { state.editRecipe = ''; state.recipeLinesLoaded = false; state.recipeLines = [{ supplyId: '', quantity: '', unit: '' }]; state.recipeDraft = null; navigate('records:catalog'); return; }
    if (action === 'delete-recipe') { deleteRecipe(id); return; }
    if (action === 'toggle-catalog') {
      const recipe = recipeById()[id];
      if (recipe) { recipe.active = recipe.active === false; save(); toast(recipe.active ? 'Sabor mostrado no cardápio.' : 'Sabor ocultado do cardápio.'); render(); }
      return;
    }
    if (action === 'edit-production') { state.editProduction = id; state.screen = 'production-edit'; render(); return; }
    if (action === 'delete-production') { deleteProduction(id); return; }
    if (action === 'edit-expense') { state.editExpense = id; state.screen = 'finance-payable'; render(); return; }
    if (action === 'delete-expense') { deleteExpense(id); return; }
    if (action === 'edit-supplier') { state.editSupplier = id; state.screen = 'supplier-edit'; render(); return; }
    if (action === 'delete-supplier') { deleteSupplier(id); return; }
    if (action === 'clear-filter') { state.reportFilter = { start: '', end: '', min: '', max: '', query: '', payment: '', status: '' }; render(); return; }
    if (action === 'export-xlsx') { exportXlsx(); return; }
    if (action === 'copy-catalog-link') { copyCatalogLink(); return; }
    if (action === 'cloud-refresh') { forceCloudRefresh(); return; }
    if (action === 'cloud-signout') { clearTimeout(cloudSyncTimer); cloudRevision = null; window.GelatosCloud.signOut(); toast('Este celular saiu da nuvem. Os dados locais foram mantidos.'); navigate('settings:cloud'); return; }
    if (action === 'backup') { backup(); return; }
    if (action === 'restore') { $('#restoreFile')?.click(); return; }
    if (action === 'restore-default-logos') { data.settings.homeLogoDataUrl = ''; data.settings.headerLogoDataUrl = ''; save(); toast('Logo padrão restaurada.'); render(); }
  });
  document.addEventListener('change', event => {
    const target = event.target;
    if (target.matches('[data-order-product]')) {
      state.orderLines[n(target.dataset.orderProduct)].productId = target.value;
      $('#orderPreview') && ($('#orderPreview').textContent = money(draftOrderTotal()));
      return;
    }
    if (target.matches('[data-order-quantity]')) {
      state.orderLines[n(target.dataset.orderQuantity)].quantity = target.value;
      $('#orderPreview') && ($('#orderPreview').textContent = money(draftOrderTotal()));
      return;
    }
    if (target.matches('[data-recipe-supply]')) {
      const line = state.recipeLines[n(target.dataset.recipeSupply)];
      line.supplyId = target.value;
      const item = supplies()[target.value];
      if (item) {
        line.unit = item.unit;
        const unit = target.closest('.recipe-item')?.querySelector('[data-recipe-unit]');
        if (unit) unit.value = item.unit;
      }
      updateRecipePreview();
      return;
    }
    if (target.matches('[data-recipe-quantity]')) { state.recipeLines[n(target.dataset.recipeQuantity)].quantity = target.value; updateRecipePreview(); return; }
    if (target.matches('[data-recipe-unit]')) { state.recipeLines[n(target.dataset.recipeUnit)].unit = target.value; updateRecipePreview(); return; }
    if (target.matches('[data-pick]')) {
      const [orderId, index] = target.dataset.pick.split(':');
      const order = data.orders.find(item => String(item.id) === String(orderId));
      if (order?.items[n(index)]) { order.items[n(index)].picked = target.checked; save(); }
      return;
    }
    if (target.matches('[data-filter]')) { state.reportFilter[target.dataset.filter] = target.value; render(); return; }
    if (target.id === 'productionRecipe') { state.productionRecipe = target.value; render(); return; }
    if (target.id === 'productionBatches') { state.productionBatches = target.value; render(); return; }
    if (target.id === 'restoreFile') { restore(target.files[0]); }
  });
  document.addEventListener('input', event => {
    const target = event.target;
    if (target.matches('[data-order-quantity]')) {
      state.orderLines[n(target.dataset.orderQuantity)].quantity = target.value;
      const preview = $('#orderPreview'); if (preview) preview.textContent = money(draftOrderTotal());
    }
    if (target.matches('[data-recipe-quantity]')) { state.recipeLines[n(target.dataset.recipeQuantity)].quantity = target.value; updateRecipePreview(); }
    if (target.matches('[data-recipe-unit]')) { state.recipeLines[n(target.dataset.recipeUnit)].unit = target.value; updateRecipePreview(); }
    if (target.closest('#recipeForm') && ['yieldUnits', 'laborAmount', 'laborMode'].includes(target.name)) updateRecipePreview();
  });
  document.addEventListener('submit', event => {
    event.preventDefault();
    const form = event.target;
    const formId = form.getAttribute('id');
    if (formId === 'cloudAuthForm') authenticateCloud(form, event.submitter?.value || 'signin');
    else if (formId === 'cloudActivateForm') activateCloud(form);
    else if (formId === 'orderForm') submitOrder(form, false);
    else if (formId === 'orderEditForm') submitOrder(form, true);
    else if (formId === 'purchaseForm') savePurchase(form);
    else if (formId === 'supplyEditForm') saveSupplyEdit(form);
    else if (formId === 'readyEditForm') saveReadyEdit(form);
    else if (formId === 'manualReadyForm') saveManualReady(form);
    else if (formId === 'recipeForm') saveRecipe(form);
    else if (formId === 'productionForm') saveProduction(form);
    else if (formId === 'productionEditForm') saveProductionEdit(form);
    else if (formId === 'expenseForm') saveExpense(form, false);
    else if (formId === 'expenseEditForm') saveExpense(form, true);
    else if (formId === 'supplierForm') saveSupplier(form, false);
    else if (formId === 'supplierEditForm') saveSupplier(form, true);
    else if (formId === 'compareForm') { state.compareSupply = form.elements.supplyId.value; state.comparePrice = form.elements.unitPrice.value; render(); }
    else if (formId === 'capacityForm') { state.capacityRecipe = form.elements.recipeId.value; render(); }
    else if (formId === 'appearanceForm') saveAppearance(form);
    else if (formId === 'messageForm') saveMessage(form);
    else if (formId === 'catalogSettingsForm') saveCatalogSettings(form);
    else if (formId === 'deliverySettingsForm') saveDeliverySettings(form);
  });
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    deferredInstall = event;
    const button = $('#installCta');
    if (button) button.hidden = false;
  });
  window.addEventListener('appinstalled', () => {
    const button = $('#installCta');
    if (button) button.hidden = true;
    toast('Gelatos Lele instalado no celular.');
  });
  $('#app').innerHTML = '<div class="boot">Carregando Gelatos Lele…</div>';
  render();
  loadCloudOnStart();
  setInterval(() => refreshFromCloud(true), 4000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshFromCloud(true);
  });
  if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('./service-worker.js').catch(() => {}));
})();
