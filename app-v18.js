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
  // Dinheiro fica em centavos; quantidades físicas podem ter três casas.
  const qty = value => Math.round((n(value) + Number.EPSILON) * 1000) / 1000;
  const qtyText = value => new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(qty(value));
  const qtyInput = value => qty(value).toFixed(3).replace('.', ',');
  const money = value => moneyFormat.format(n(value));
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
  const normalizeProductType = value => {
    const type = String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleLowerCase('pt-BR');
    if (type === 'agua') return 'Água';
    if (type === 'leite') return 'Leite';
    return 'Gourmet';
  };
  // Categorias são um cadastro da empresa. Estes três registros mantêm a
  // organização já usada no cardápio, mas podem ser renomeados ou expandidos.
  const DEFAULT_PRODUCT_CATEGORIES = [
    { id: 'agua', name: 'Geladinho de água' },
    { id: 'leite', name: 'Geladinho de leite' },
    { id: 'gourmet', name: 'Geladinho gourmet' }
  ];
  const defaultProductCategories = () => DEFAULT_PRODUCT_CATEGORIES.map(item => ({ ...item }));
  const categorySlug = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const legacyCategoryId = value => {
    const type = normalizeProductType(value);
    return type === 'Água' ? 'agua' : type === 'Leite' ? 'leite' : 'gourmet';
  };
  function normalizeProductCategories(raw) {
    const source = Array.isArray(raw) && raw.length ? raw : defaultProductCategories();
    const used = new Set();
    const entries = source.map((item, index) => {
      const name = String(item?.name || '').trim();
      let id = categorySlug(item?.id || name) || 'categoria-' + (index + 1);
      const base = id;
      let suffix = 2;
      while (used.has(id)) id = base + '-' + suffix++;
      used.add(id);
      return name ? { id, name } : null;
    }).filter(Boolean);
    return entries.length ? entries : defaultProductCategories();
  }
  const categoryNameFrom = (list, id, legacy) => list.find(item => String(item.id) === String(id))?.name || (legacy ? normalizeProductType(legacy) : '') || list[0]?.name || 'Geladinho';
  const brDate = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? String(value).slice(8, 10) + '/' + String(value).slice(5, 7) + '/' + String(value).slice(0, 4) : '—';
  const brDateTime = value => {
    const instant = new Date(value);
    return Number.isNaN(instant.getTime()) ? '—' : instant.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  };
  const empty = text => '<p class="list-empty">' + esc(text) + '</p>';
  const day = value => String(value || '').slice(0, 10);
  const byId = (list, key = 'id') => Object.fromEntries(list.map(item => [String(item[key]), item]));
  // Fotos de sabores vão para o cardápio público. Reduzimos as novas fotos
  // antes de salvar para o link abrir rápido no celular, sem apagar fotos
  // antigas que já tenham sido cadastradas.
  const readFileDataUrl = file => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Não foi possível ler a imagem.'));
    reader.readAsDataURL(file);
  });
  const optimizeProductImage = async file => {
    const source = await readFileDataUrl(file);
    return new Promise(resolve => {
      const image = new Image();
      image.onload = () => {
        try {
          const maxSide = 960;
          const scale = Math.min(1, maxSide / Math.max(image.naturalWidth || 1, image.naturalHeight || 1));
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round((image.naturalWidth || 1) * scale));
          canvas.height = Math.max(1, Math.round((image.naturalHeight || 1) * scale));
          const context = canvas.getContext('2d');
          context.drawImage(image, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/jpeg', 0.82));
        } catch (_) { resolve(source); }
      };
      image.onerror = () => resolve(source);
      image.src = source;
    });
  };

  const DEFAULT_SETTINGS = {
    pixKey: '',
    homeLogoDataUrl: '',
    headerLogoDataUrl: '',
    catalogLogoDataUrl: '',
    whatsappTemplate: 'Olá, {nome}!\n\nSeu pedido Gelatos Lele foi confirmado!\n\n{itens}\n\nValor total: {total}\n\nChave Pix: {pix}',
    catalogName: 'Gelatos Lele',
    catalogIntro: 'Geladinhos artesanais preparados com carinho. Confira os sabores disponíveis e faça seu pedido.',
    catalogPhone: '',
    businessAddress: '',
    pickupAddress: '',
    deliveryModes: 'Retirada,Entrega',
    deliveryZones: '',
    freeDeliveryMinValue: '',
    freeDeliveryMinItems: '',
    creditFeePercent: '',
    debitFeePercent: '',
    reservationMinutes: '20',
    scheduledEnabled: true,
    scheduledLeadDays: '2',
    scheduledMaxItemsPerDay: ''
  };
  // O fechamento inicial registra a realidade financeira no dia em que a
  // empresa começa a usar o app. Não representa vendas novas e, portanto,
  // não altera faturamento, custo ou lucro operacional.
  const defaultOpeningFinancial = () => ({
    date: '',
    balances: { Dinheiro: 0, Pix: 0, Crédito: 0, Débito: 0 },
    receivableTotal: 0,
    receivableRemaining: 0,
    payableTotal: 0,
    payableRemaining: 0,
    note: '',
    receipts: [],
    payments: []
  });
  function normalizeOpeningFinancial(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const base = defaultOpeningFinancial();
    const balances = Object.fromEntries(METHODS.map(method => [method, Math.max(0, n(source.balances?.[method]))]));
    const records = key => Array.isArray(source[key]) ? source[key].map(item => ({
      id: item.id || uid(),
      total: Math.max(0, n(item.total)),
      paymentMethod: METHODS.includes(item.paymentMethod) ? item.paymentMethod : 'Pix',
      date: /^\d{4}-\d{2}-\d{2}$/.test(String(item.date || '')) ? item.date : today(),
      note: String(item.note || '').trim()
    })).filter(item => item.total > 0) : [];
    const receipts = records('receipts');
    const payments = records('payments');
    const receivableTotal = Math.max(0, n(source.receivableTotal));
    const payableTotal = Math.max(0, n(source.payableTotal));
    const received = receipts.reduce((sum, item) => sum + n(item.total), 0);
    const paid = payments.reduce((sum, item) => sum + n(item.total), 0);
    return {
      ...base,
      ...source,
      date: /^\d{4}-\d{2}-\d{2}$/.test(String(source.date || '')) ? source.date : '',
      balances,
      receivableTotal,
      receivableRemaining: Math.max(0, Math.min(receivableTotal, Object.prototype.hasOwnProperty.call(source, 'receivableRemaining') ? n(source.receivableRemaining) : Math.max(0, receivableTotal - received))),
      payableTotal,
      payableRemaining: Math.max(0, Math.min(payableTotal, Object.prototype.hasOwnProperty.call(source, 'payableRemaining') ? n(source.payableRemaining) : Math.max(0, payableTotal - paid))),
      note: String(source.note || '').trim(),
      receipts,
      payments
    };
  }
  const blankData = () => ({
    version: 18,
    supplies: [], recipes: [], productions: [], readyStock: [], orders: [], expenses: [],
    suppliers: [], purchases: [], productCategories: defaultProductCategories(), notifications: [], notificationKeys: [], openingFinancial: defaultOpeningFinancial(), settings: { ...DEFAULT_SETTINGS }
  });
  function normalize(raw) {
    const old = raw && typeof raw === 'object' ? raw : {};
    const settings = old.settings || {};
    const productCategories = normalizeProductCategories(old.productCategories);
    const categoryId = item => productCategories.some(entry => String(entry.id) === String(item?.productCategoryId))
      ? String(item.productCategoryId)
      : (productCategories.some(entry => entry.id === legacyCategoryId(item?.productType)) ? legacyCategoryId(item?.productType) : productCategories[0].id);
    return {
      ...blankData(), ...old,
      productCategories,
      supplies: Array.isArray(old.supplies) ? old.supplies.map(item => ({
        ...item,
        category: item.category === 'supply' ? 'supply' : 'ingredient',
        quantity: Math.max(0, n(item.quantity)),
        averageUnitCost: Math.max(0, n(item.averageUnitCost)),
        minimumStock: Math.max(0, n(item.minimumStock)),
        unit: item.unit || 'un.',
        active: item.active !== false,
        archivedAt: item.archivedAt || '',
        movements: Array.isArray(item.movements) ? item.movements : []
      })) : [],
      recipes: Array.isArray(old.recipes) ? old.recipes.map(item => ({
        ...item,
        active: item.active !== false,
        productCategoryId: categoryId(item),
        productType: categoryNameFrom(productCategories, categoryId(item), item.productType),
        description: item.description || '',
        preparation: item.preparation || '',
        laborAmount: Math.max(0, n(item.laborAmount)),
        laborMode: item.laborMode === 'unit' ? 'unit' : 'batch',
        items: Array.isArray(item.items) ? item.items : []
      })) : [],
      productions: Array.isArray(old.productions) ? old.productions : [],
      readyStock: Array.isArray(old.readyStock) ? old.readyStock.map(item => ({
        ...item,
        productCategoryId: categoryId(item),
        productType: categoryNameFrom(productCategories, categoryId(item), item.productType),
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
        paymentFee: Math.max(0, n(item.paymentFee)),
        deliveryCost: Math.max(0, n(item.deliveryCost)),
        reservationExpiresAt: item.reservationExpiresAt || '',
        approvedAt: item.approvedAt || '',
        expiredAt: item.expiredAt || '',
        status: item.status || 'confirmed',
        orderKind: item.orderKind === 'scheduled' ? 'scheduled' : 'ready',
        scheduledFor: /^\d{4}-\d{2}-\d{2}$/.test(String(item.scheduledFor || '')) ? String(item.scheduledFor) : '',
        stockReserved: item.orderKind === 'scheduled' ? item.stockReserved === true : item.stockReserved !== false
      })) : [],
      expenses: Array.isArray(old.expenses) ? old.expenses : [],
      openingFinancial: normalizeOpeningFinancial(old.openingFinancial),
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
      'recipe-view': 'records-catalog',
      'stock-ready-manual': 'stock-ready',
      'production-edit': 'production',
      'supplier-edit': 'records-suppliers',
      'category-edit': 'records-categories'
    };
    const screen = fallback[String(value || '')] || String(value || '');
    return /^(home|orders-(new|history)|stock-(purchase|ingredient|supply|ready)|recipes|production|finance-(overview|receivable|payable|opening|opening-receive|opening-pay)|reports-(orders|finance|stock)|records-(catalog|suppliers|categories)|tools-(compare|capacity)|settings-(home|cloud|team|appearance|message|catalog|delivery|backup|restore-preview))$/.test(screen) ? screen : 'home';
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
  const productCategories = () => data.productCategories || [];
  const categoryFor = item => {
    const list = productCategories();
    const id = list.some(entry => String(entry.id) === String(item?.productCategoryId))
      ? String(item.productCategoryId)
      : (list.some(entry => entry.id === legacyCategoryId(item?.productType)) ? legacyCategoryId(item?.productType) : list[0]?.id || 'gourmet');
    return { id, name: categoryNameFrom(list, id, item?.productType) };
  };
  let cloudRevision = null;
  // Última cópia confirmada pela nuvem. Ela permite conciliar duas alterações
  // feitas em aparelhos diferentes sem simplesmente jogar fora uma delas.
  let cloudBaseData = null;
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
    editProductCategory: '',
    editExpense: '',
    viewRecipe: '',
    teamMembers: null,
    teamError: '',
    restorePreview: null,
    serverBackups: null,
    serverBackupError: '',
    deliveryDraft: null,
    compareSupply: '',
    comparePrice: '',
    compareQuantity: '',
    reportFilter: { start: '', end: '', min: '', max: '', query: '', payment: '', status: '', location: '' },
    reportRanking: ''
  };
  // Cada endereço (Netlify, GitHub Pages etc.) possui seu próprio armazenamento do navegador.
  // Ao abrir o app em um endereço novo, encaminhe para a entrada em vez de exibir um painel vazio.
  if (window.GelatosCloud && !window.GelatosCloud.hasSession()) state.screen = 'settings-cloud';
  function saveLocal() { localStorage.setItem(STORE, JSON.stringify(data)); }
  const cloneData = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  const sameData = (left, right) => JSON.stringify(left) === JSON.stringify(right);
  const isRecord = value => value && typeof value === 'object' && !Array.isArray(value);
  function recordKey(value) {
    if (!isRecord(value)) return '';
    return value.id || value.recipeId || value.supplyId || value.productId || '';
  }
  function mergeCloudValue(base, local, remote, path, conflicts) {
    if (sameData(local, remote)) return cloneData(local);
    if (sameData(local, base)) return cloneData(remote);
    if (sameData(remote, base)) return cloneData(local);
    if (Array.isArray(local) && Array.isArray(remote)) return mergeCloudList(Array.isArray(base) ? base : [], local, remote, path, conflicts);
    if (isRecord(local) && isRecord(remote)) {
      const merged = {};
      const baseRecord = isRecord(base) ? base : {};
      new Set([...Object.keys(baseRecord), ...Object.keys(local), ...Object.keys(remote)]).forEach(key => {
        const hasLocal = Object.prototype.hasOwnProperty.call(local, key);
        const hasRemote = Object.prototype.hasOwnProperty.call(remote, key);
        const hasBase = Object.prototype.hasOwnProperty.call(baseRecord, key);
        if (!hasLocal && !hasRemote) return;
        if (!hasLocal) {
          if (!hasBase || !sameData(remote[key], baseRecord[key])) merged[key] = cloneData(remote[key]);
          return;
        }
        if (!hasRemote) {
          if (!hasBase || !sameData(local[key], baseRecord[key])) merged[key] = cloneData(local[key]);
          return;
        }
        merged[key] = mergeCloudValue(baseRecord[key], local[key], remote[key], path + '.' + key, conflicts);
      });
      return merged;
    }
    // O mesmo campo foi alterado nos dois aparelhos. Mantemos a mudança local
    // e registramos o conflito para que a pessoa confira, em vez de descartá-la
    // silenciosamente como a versão anterior fazia.
    conflicts.push(path);
    return cloneData(local);
  }
  function mergeCloudList(base, local, remote, path, conflicts) {
    const all = [...base, ...local, ...remote];
    if (!all.every(item => recordKey(item))) {
      return local.concat(remote.filter(item => !local.some(localItem => sameData(localItem, item))));
    }
    const mapFor = list => new Map(list.map(item => [String(recordKey(item)), item]));
    const baseMap = mapFor(base), localMap = mapFor(local), remoteMap = mapFor(remote);
    const keys = [...localMap.keys(), ...remoteMap.keys(), ...baseMap.keys()].filter((key, index, list) => list.indexOf(key) === index);
    const merged = [];
    keys.forEach(key => {
      const hasBase = baseMap.has(key), hasLocal = localMap.has(key), hasRemote = remoteMap.has(key);
      const baseItem = baseMap.get(key), localItem = localMap.get(key), remoteItem = remoteMap.get(key);
      if (!hasLocal && !hasRemote) return;
      if (!hasLocal) {
        if (!hasBase || !sameData(remoteItem, baseItem)) merged.push(cloneData(remoteItem));
        return;
      }
      if (!hasRemote) {
        if (!hasBase || !sameData(localItem, baseItem)) merged.push(cloneData(localItem));
        return;
      }
      merged.push(mergeCloudValue(baseItem, localItem, remoteItem, path + '[' + key + ']', conflicts));
    });
    return merged;
  }
  function reconcileCloudState(remoteState) {
    const conflicts = [];
    const remote = normalize(remoteState);
    const base = cloudBaseData ? normalize(cloudBaseData) : remote;
    const merged = normalize(mergeCloudValue(base, data, remote, 'dados', conflicts));
    if (conflicts.length) {
      merged.notifications.unshift({
        id: uid(), type: 'sync', title: 'Revisar sincronização',
        body: 'Algumas informações foram alteradas nos dois celulares. A alteração deste celular foi mantida nos campos: ' + conflicts.slice(0, 3).join(', ') + (conflicts.length > 3 ? '…' : '') + '.',
        route: 'settings-cloud', date: new Date().toISOString(), read: false
      });
    }
    return { merged, conflicts };
  }
  let cloudDirty = false;
  async function syncCloudNow(silent = false) {
    if (cloudSaving || cloudRevision === null || !window.GelatosCloud?.hasSession()) return;
    cloudSaving = true;
    try {
      const sent = cloneData(data);
      const saved = await window.GelatosCloud.saveState(sent, cloudRevision);
      cloudRevision = Number(saved.revision);
      cloudBaseData = cloneData(sent);
      cloudDirty = !sameData(data, sent);
      if (cloudDirty) queueCloudSave();
      if (!silent) toast('Alterações salvas na nuvem.');
    } catch (error) {
      if (/CONFLITO/i.test(error.message || '')) {
        try {
          const latest = await window.GelatosCloud.getState();
          const reconciliation = reconcileCloudState(latest.state);
          data = reconciliation.merged;
          cloudRevision = Number(latest.revision);
          const mergedSnapshot = cloneData(data);
          const saved = await window.GelatosCloud.saveState(mergedSnapshot, cloudRevision);
          cloudRevision = Number(saved.revision);
          cloudBaseData = cloneData(mergedSnapshot);
          cloudDirty = !sameData(data, mergedSnapshot);
          saveLocal();
          render();
          if (cloudDirty) queueCloudSave();
          toast(reconciliation.conflicts.length ? 'Dados conciliados. Há um aviso para revisar campos alterados nos dois celulares.' : 'Dados dos dois celulares foram conciliados e salvos.');
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
  const save = () => { saveLocal(); cloudDirty = true; queueCloudSave(); };
  async function refreshFromCloud(silent = true) {
    if (cloudPolling || cloudRevision === null || !window.GelatosCloud?.hasSession() || document.hidden) return;
    cloudPolling = true;
    try {
      const latest = await window.GelatosCloud.getState();
      if (Number(latest.revision) > Number(cloudRevision)) {
        if (cloudDirty) {
          const reconciliation = reconcileCloudState(latest.state);
          data = reconciliation.merged;
          cloudRevision = Number(latest.revision);
          cloudBaseData = cloneData(normalize(latest.state));
          saveLocal();
          render();
          queueCloudSave();
          if (!silent) toast('Alterações dos dois celulares foram conciliadas.');
          return;
        }
        data = normalize(latest.state);
        cloudRevision = Number(latest.revision);
        cloudBaseData = cloneData(data);
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
      cloudBaseData = cloneData(data);
      cloudDirty = false;
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
        data = cloudDirty ? reconcileCloudState(latest.state).merged : normalize(latest.state);
        cloudRevision = Number(latest.revision);
        cloudBaseData = cloneData(normalize(latest.state));
        saveLocal();
        render();
        if (cloudDirty) queueCloudSave();
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
  const activeSupplies = () => data.supplies.filter(item => item.active !== false);
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
    activeSupplies().forEach(item => {
      if (n(item.minimumStock) > 0 && n(item.quantity) <= n(item.minimumStock)) {
        const key = 'min-supply-' + item.id;
        active.push(key);
        addNotice('stock', 'Estoque mínimo: ' + item.name, 'Restam ' + qtyText(item.quantity) + ' ' + item.unit + '.', item.category === 'supply' ? 'stock-supply' : 'stock-ingredient', key);
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
  const openingFinancial = () => data.openingFinancial || defaultOpeningFinancial();
  const openingBalanceTotal = () => round(METHODS.reduce((sum, method) => sum + n(openingFinancial().balances?.[method]), 0));
  function paymentBalances() {
    const opening = openingFinancial();
    const values = Object.fromEntries(METHODS.map(method => [method, n(opening.balances?.[method]) ]));
    data.orders.filter(order => order.status === 'paid').forEach(order => values[order.paymentMethod] = round(values[order.paymentMethod] + n(order.total) - n(order.paymentFee)));
    data.expenses.filter(expense => !expense.voided).forEach(expense => values[expense.paymentMethod] = round(values[expense.paymentMethod] - n(expense.total)));
    opening.receipts.forEach(item => values[item.paymentMethod] = round(values[item.paymentMethod] + n(item.total)));
    opening.payments.forEach(item => values[item.paymentMethod] = round(values[item.paymentMethod] - n(item.total)));
    return values;
  }
  function finance(orders = data.orders.filter(order => order.status === 'paid'), expenses = data.expenses.filter(expense => expense.category !== 'purchase')) {
    const revenue = round(orders.reduce((sum, order) => sum + n(order.total), 0));
    const cost = round(orders.reduce((sum, order) => sum + n(order.cost), 0));
    const paymentFee = round(orders.reduce((sum, order) => sum + n(order.paymentFee), 0));
    const deliveryCost = round(orders.reduce((sum, order) => sum + n(order.deliveryCost), 0));
    const expense = round(expenses.filter(item => !item.voided).reduce((sum, item) => sum + n(item.total), 0));
    return { revenue, cost, paymentFee, deliveryCost, expense, profit: round(revenue - cost - paymentFee - deliveryCost - expense) };
  }
  function paymentFeeFor(total, payment) {
    const rate = payment === 'Crédito' ? n(data.settings.creditFeePercent) : payment === 'Débito' ? n(data.settings.debitFeePercent) : 0;
    return round(n(total) * Math.max(0, rate) / 100);
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
  // Este é o lucro bruto do sabor: preço de venda menos material e mão de obra.
  // Frete e despesas gerais continuam aparecendo no lucro real do Financeiro.
  function recipeMetrics(recipe) {
    const cost = fullRecipeCost(recipe);
    const saleUnitPrice = n(recipe.saleUnitPrice);
    const unitProfit = round(saleUnitPrice - cost.unitCost);
    return {
      ...cost,
      saleUnitPrice,
      unitProfit,
      margin: saleUnitPrice > 0 ? round(unitProfit / saleUnitPrice * 100) : 0
    };
  }
  function createProduction(recipe, batches, date, correction = false) {
    const result = window.GelatosCore.produce(recipe, batches, supplies());
    const labor = laborCost(recipe, batches);
    result.totalCost = round(result.totalCost + labor);
    result.unitCost = round(result.totalCost / result.outputQuantity);
    result.consumed.forEach(line => {
      const item = supplies()[line.supplyId];
      item.quantity = qty(n(item.quantity) - n(line.quantity));
      item.movements.push({ id: uid(), kind: correction ? 'Produção corrigida' : 'Produção', quantity: -n(line.quantity), total: n(line.cost), date });
    });
    let product = ready()[recipe.id];
    const category = categoryFor(recipe);
    if (product) {
      const oldQty = n(product.quantity);
      product.unitCost = round((oldQty * n(product.unitCost) + n(result.outputQuantity) * n(result.unitCost)) / (oldQty + n(result.outputQuantity)));
      product.quantity = qty(oldQty + n(result.outputQuantity));
      product.saleUnitPrice = n(recipe.saleUnitPrice);
      product.productCategoryId = category.id;
      product.productType = category.name;
      product.movements.push({ id: uid(), kind: correction ? 'Produção corrigida' : 'Produção', quantity: n(result.outputQuantity), date });
    } else {
      product = { id: uid(), recipeId: recipe.id, name: recipe.name, productCategoryId: category.id, productType: category.name, quantity: n(result.outputQuantity), unitCost: n(result.unitCost), saleUnitPrice: n(recipe.saleUnitPrice), minimumStock: 0, movements: [{ id: uid(), kind: 'Produção', quantity: n(result.outputQuantity), date }] };
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
      item.quantity = qty(n(item.quantity) + n(line.quantity));
      item.movements.push({ id: uid(), kind: 'Estorno de produção', quantity: n(line.quantity), total: 0, date: today() });
    });
    const remaining = qty(n(product.quantity) - n(production.outputQuantity));
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
      state.reportFilter = preset ? reportPreset(preset) : { start: '', end: '', min: '', max: '', query: '', payment: '', status: '', location: '' };
    } else if (route.startsWith('records:')) state.screen = 'records-' + route.split(':')[1];
    else if (route.startsWith('tools:')) state.screen = 'tools-' + route.split(':')[1];
    else if (route.startsWith('settings:')) state.screen = 'settings-' + route.split(':')[1];
    else state.screen = route;
    render();
    if (state.screen === 'settings-team') loadTeamMembers();
    if (state.screen === 'settings-backup') loadServerBackups();
    refreshFromCloud(true);
  }
  function reportPreset(preset) {
    const filter = { start: '', end: '', min: '', max: '', query: '', payment: '', status: '', location: '' };
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
      navGroup('Financeiro', 'finance', [['Visão financeira', 'finance:overview'], ['Contas a receber', 'finance:receivable'], ['Contas pagas', 'finance:payable'], ['Fechamento inicial', 'finance:opening']]) +
      navGroup('Relatórios', 'reports', [['Pedidos', 'reports:orders'], ['Financeiro', 'reports:finance'], ['Estoque', 'reports:stock']]) +
      navGroup('Cadastros', 'records', [['Cardápio / sabores', 'records:catalog'], ['Categorias de geladinho', 'records:categories'], ['Ingredientes', 'stock:ingredient'], ['Insumos', 'stock:supply'], ['Fornecedores', 'records:suppliers']]) +
      navGroup('Ferramentas', 'tools', [['Preços e compras', 'tools:compare'], ['Produção possível', 'tools:capacity']]) +
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
      metric('Lucro real do mês', 'dashProfit', 'Vendas − custos − taxas − despesas', 'reports:finance:month') +
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
    if (state.screen === 'recipe-view') return recipeViewScreen();
    if (state.screen === 'production') return productionScreen();
    if (state.screen === 'production-edit') return productionEditScreen();
    if (state.screen.startsWith('finance-')) return financeScreen();
    if (state.screen.startsWith('reports-')) return reportsScreen();
    if (state.screen === 'records-catalog') return catalogScreen();
    if (state.screen === 'records-categories') return categoryScreen();
    if (state.screen === 'category-edit') return categoryEditScreen();
    if (state.screen === 'records-suppliers') return supplierScreen();
    if (state.screen === 'supplier-edit') return supplierEditScreen();
    if (state.screen.startsWith('tools-')) return toolsScreen();
    if (state.screen.startsWith('settings-')) return settingsScreen();
    return homeScreen();
  }
  function manualOrderProducts() {
    return data.recipes.filter(recipe => recipe.active !== false).map(recipe => {
      const produced = ready()[recipe.id];
      return {
        ...recipe,
        id: recipe.id,
        quantity: n(produced?.quantity),
        saleUnitPrice: n(produced?.saleUnitPrice || recipe.saleUnitPrice)
      };
    }).sort((left, right) => {
      const leftCategory = categoryFor(left).name;
      const rightCategory = categoryFor(right).name;
      return leftCategory.localeCompare(rightCategory, 'pt-BR') || left.name.localeCompare(right.name, 'pt-BR');
    });
  }
  function manualOrderOptions(selected) {
    const grouped = productCategories().map(category => ({
      category,
      products: manualOrderProducts().filter(product => categoryFor(product).id === category.id)
    })).filter(group => group.products.length);
    const option = product => {
      const available = n(product.quantity) > 0;
      const chosen = String(product.id) === String(selected);
      const label = product.name + ' · ' + (available ? qtyText(product.quantity) + ' un. em estoque' : 'esgotado') + ' · ' + money(product.saleUnitPrice);
      return '<option value="' + esc(product.id) + '"' + (chosen ? ' selected' : '') + (available ? '' : ' disabled') + '>' + esc(label) + '</option>';
    };
    return '<option value="">Selecione</option>' + grouped.map(group => '<optgroup label="' + esc(group.category.name) + '">' + group.products.map(option).join('') + '</optgroup>').join('');
  }
  function orderLinesMarkup() {
    const editingScheduled = data.orders.find(order => String(order.id) === String(state.editOrder))?.orderKind === 'scheduled';
    const products = editingScheduled
      ? data.recipes.filter(recipe => recipe.active !== false).map(recipe => ({ ...recipe, id: recipe.id, quantity: n(ready()[recipe.id]?.quantity), saleUnitPrice: n(recipe.saleUnitPrice) }))
      : manualOrderProducts();
    return state.orderLines.map((line, index) => {
      const choices = editingScheduled
        ? options(products, line.productId, item => item.name + ' · encomenda · ' + money(item.saleUnitPrice))
        : manualOrderOptions(line.productId);
      return '<div class="order-line"><select data-order-product="' + index + '">' + choices + '</select><input data-order-quantity="' + index + '" inputmode="decimal" value="' + esc(line.quantity) + '" aria-label="Quantidade"><button type="button" class="line-remove" data-action="remove-order-line" data-index="' + index + '" aria-label="Remover item">×</button></div>';
    }).join('');
  }
  function draftOrderTotal() {
    return round(state.orderLines.reduce((sum, line) => {
      const product = ready()[line.productId] || recipeById()[line.productId];
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
    if (order.status === 'paid') return 'pago';
    if (order.status === 'cancelled') return 'cancelado';
    if (order.status === 'expired') return 'reserva expirada';
    if (order.status === 'reserved') return 'aguardando aprovação';
    if (order.status === 'scheduled') return 'encomenda programada';
    if (order.status === 'production') return 'em produção';
    return 'pendente';
  }
  function orderCard(order) {
    const lines = order.items.map(item => '<li>' + round(item.quantity) + ' × ' + esc(item.productName) + ' — ' + money(item.total) + '</li>').join('');
    const locked = order.status === 'cancelled' || order.status === 'expired';
    const pick = order.items.map((item, index) => '<label><input type="checkbox" data-pick="' + esc(order.id) + ':' + index + '"' + (item.picked ? ' checked' : '') + (locked ? ' disabled' : '') + '> Separar ' + round(item.quantity) + ' × ' + esc(item.productName) + '</label>').join('');
    let actions = '<button class="outline" data-action="edit-order" data-id="' + esc(order.id) + '">Editar</button>';
    if (order.status === 'reserved') actions += '<button class="primary" data-action="approve-order" data-id="' + esc(order.id) + '">Aprovar pedido</button>';
    if (order.status === 'scheduled') actions += '<button class="primary" data-action="start-scheduled-production" data-id="' + esc(order.id) + '">Marcar em produção</button>';
    if (order.status === 'production') actions += '<button class="primary" data-action="reserve-scheduled-order" data-id="' + esc(order.id) + '">Reservar itens prontos</button>';
    if (order.status === 'confirmed' || order.status === 'paid') actions += '<button class="secondary" data-action="send-order" data-id="' + esc(order.id) + '">Enviar confirmação</button>';
    if (order.status === 'confirmed') actions += '<button class="primary" data-action="mark-paid" data-id="' + esc(order.id) + '">Marcar como pago</button>';
    if (!locked) actions += '<button class="outline" data-action="cancel-order" data-id="' + esc(order.id) + '">Cancelar</button>';
    actions += '<button class="outline danger-button" data-action="delete-order" data-id="' + esc(order.id) + '">Arquivar</button>';
    const reservation = order.status === 'reserved' ? '<dt>Reserva até</dt><dd>' + brDateTime(order.reservationExpiresAt) + '</dd>' : order.status === 'expired' ? '<dt>Reserva expirada</dt><dd>' + brDateTime(order.expiredAt) + '</dd>' : '';
    const schedule = order.orderKind === 'scheduled' ? '<dt>Encomenda para</dt><dd>' + brDate(order.scheduledFor || order.dueDate) + '</dd><dt>Reserva de estoque</dt><dd>' + (order.stockReserved ? 'Itens prontos já reservados' : 'Aguardando produção') + '</dd>' : '';
    const checklist = order.stockReserved ? '<h4>Checklist de separação</h4><div class="pick-list">' + pick + '</div>' : '<section class="form-note"><b>Planejamento de produção:</b> produza os itens e então use “Reservar itens prontos”. Nenhum geladinho foi baixado do estoque ainda.</section>';
    return detail(order.customer, brDate(order.date) + (order.orderKind === 'scheduled' ? ' · entrega/retirada em ' + brDate(order.scheduledFor || order.dueDate) : ' · vence ' + brDate(order.dueDate)) + ' · ' + esc(order.paymentMethod), money(order.total), orderStatus(order), '<dl><dt>WhatsApp</dt><dd>' + esc(order.phone || 'não informado') + '</dd>' + schedule + reservation + '<dt>Custo vendido</dt><dd>' + money(order.cost) + '</dd><dt>Custo de entrega</dt><dd>' + money(order.deliveryCost) + '</dd><dt>Taxa de pagamento</dt><dd>' + money(order.paymentFee) + '</dd><dt>Lucro da venda</dt><dd>' + money(order.profit) + '</dd></dl>' + checklist + '<h4>Itens</h4><ul>' + lines + '</ul><div class="details-actions">' + actions + '</div>');
  }
  function ordersScreen() {
    if (state.screen === 'orders-history') {
      const cards = data.orders.filter(order => !order.archived).slice().sort((a, b) => String(b.date).localeCompare(String(a.date))).map(orderCard).join('') || empty('Nenhum pedido criado ainda.');
      return '<section class="screen active">' + heading('Controle de pedidos', 'Pedidos realizados', 'Acompanhe encomendas, produção, reservas, pagamento e separação. O histórico financeiro continua preservado.') + '<div class="list">' + cards + '</div></section>';
    }
    const draft = state.orderDraft || { customer: '', phone: '', payment: 'Pix', date: today(), dueDate: today() };
    return '<section class="screen active">' + heading('Controle de pedidos', 'Novo pedido', 'Use o mesmo cardápio do cliente. Sabores sem estoque aparecem, mas ficam bloqueados para evitar venda além do produzido.') + '<form id="orderForm" class="panel form-panel"><h2>Dados do cliente</h2><div class="form-grid two">' +
      field('Nome do cliente', '<input name="customer" required value="' + esc(draft.customer) + '" placeholder="Ex.: Maria">') +
      field('WhatsApp', '<input name="phone" inputmode="tel" value="' + esc(draft.phone) + '" placeholder="Ex.: 11999999999">') +
      '</div><div class="section-line"><div><h3>Itens do pedido</h3><p>Todos os sabores ativos do cardápio aparecem organizados por categoria. Os esgotados ficam visíveis, mas não podem ser selecionados.</p></div></div><div class="line-list">' + orderLinesMarkup() + '</div><button type="button" class="outline full" data-action="add-order-line">+ Adicionar outro geladinho</button><div class="form-grid two">' +
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
    const cards = activeSupplies().filter(item => item.category === category).sort((a, b) => a.name.localeCompare(b.name)).map(item => {
      const moves = item.movements.slice(-8).reverse().map(move => '<li>' + brDate(move.date) + ' · ' + esc(move.kind) + ' · ' + (n(move.quantity) >= 0 ? '+' : '') + qtyText(move.quantity) + ' ' + esc(item.unit) + (move.reason ? ' · ' + esc(move.reason) : '') + '</li>').join('') || '<li>Sem movimentações.</li>';
      const prices = purchaseStats(item);
      const priceSummary = prices.priced.length ? '<dt>Menor preço pago</dt><dd>' + money(prices.lowestEntry.unitPrice) + ' / ' + esc(item.unit) + '</dd><dt>Média das compras</dt><dd>' + money(prices.weightedAverage) + ' / ' + esc(item.unit) + '</dd>' : '<dt>Histórico de preços</dt><dd>Sem compras registradas</dd>';
      return detail(item.name, 'Quantidade: ' + qtyText(item.quantity) + ' ' + esc(item.unit) + ' · mínimo: ' + qtyText(item.minimumStock), money(item.averageUnitCost) + '/' + esc(item.unit), n(item.minimumStock) > 0 && n(item.quantity) <= n(item.minimumStock) ? 'mínimo' : 'em estoque', '<dl><dt>Quantidade atual</dt><dd>' + qtyText(item.quantity) + ' ' + esc(item.unit) + '</dd><dt>Custo médio do estoque</dt><dd>' + money(item.averageUnitCost) + ' / ' + esc(item.unit) + '</dd><dt>Valor em estoque</dt><dd>' + money(n(item.quantity) * n(item.averageUnitCost)) + '</dd><dt>Última compra</dt><dd>' + brDate(item.lastPurchaseAt) + '</dd><dt>Fornecedor</dt><dd>' + esc(item.lastSupplierName || '—') + '</dd>' + priceSummary + '</dl><h4>Movimentações recentes</h4><ul>' + moves + '</ul><div class="details-actions"><button class="secondary" data-action="inspect-price" data-id="' + esc(item.id) + '">Consultar preços</button><button class="outline" data-action="edit-supply" data-id="' + esc(item.id) + '">Editar</button><button class="outline danger-button" data-action="delete-supply" data-id="' + esc(item.id) + '">Excluir</button></div>');
    }).join('') || empty('Nenhum item cadastrado.');
    const archived = data.supplies.filter(item => item.category === category && item.active === false).map(item => '<li><b>' + esc(item.name) + '</b><span>Histórico preservado</span><button class="outline" data-action="restore-supply" data-id="' + esc(item.id) + '">Reativar</button></li>').join('');
    return '<section class="screen active">' + heading('Controle de estoque', label, 'Toque em um item para conferir movimentações ou editar todas as informações.') + '<div class="isolated-actions"><button class="primary" data-route="stock:purchase">Cadastrar nova compra</button></div><div class="list">' + cards + '</div>' + (archived ? '<details class="panel archived-list"><summary>Itens arquivados</summary><ul>' + archived + '</ul></details>' : '') + '</section>';
  }
  function purchaseScreen() {
    return '<section class="screen active">' + heading('Controle de estoque', 'Cadastrar compra', 'Registre a entrada uma vez. O custo médio e o financeiro são atualizados automaticamente.') + '<form id="purchaseForm" class="panel form-panel"><div class="form-grid two">' +
      field('Item já cadastrado', '<select name="supplyId">' + options(activeSupplies().slice().sort((a, b) => a.name.localeCompare(b.name)), '', item => item.name + ' (' + qtyText(item.quantity) + ' ' + item.unit + ')') + '</select>', 'Selecione aqui quando estiver comprando novamente algo que já existe.') +
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
      field('Quantidade atual', '<input name="quantity" required inputmode="decimal" value="' + esc(qtyInput(item.quantity)) + '">', 'Quantidade física que existe agora. Ingredientes e insumos aceitam três casas decimais.') +
      field('Custo médio por unidade (R$)', '<input name="averageUnitCost" required inputmode="decimal" value="' + esc(String(item.averageUnitCost).replace('.', ',')) + '">', 'Custo usado para calcular a receita a partir de agora.') +
      field('Estoque mínimo', '<input name="minimumStock" inputmode="decimal" value="' + esc(qtyInput(item.minimumStock)) + '">') +
      field('Data da última compra', '<input name="lastPurchaseAt" type="date" value="' + esc(item.lastPurchaseAt || '') + '">') +
      field('Fornecedor da última compra', '<input name="lastSupplierName" value="' + esc(item.lastSupplierName || '') + '">') +
      '</div><label class="form-field"><span>Motivo da correção de quantidade' + info('Obrigatório somente se a quantidade atual for alterada. Fica no histórico para vocês saberem por que o saldo mudou.', 'Ajuste de estoque') + '</span><textarea name="adjustmentReason" rows="2" placeholder="Ex.: conferência física, perda, item vencido"></textarea></label><div class="button-row"><button class="primary">Salvar todas as alterações</button><button class="outline" type="button" data-route="stock:' + (item.category === 'supply' ? 'supply' : 'ingredient') + '">Cancelar</button><button class="outline danger-button" type="button" data-action="delete-supply" data-id="' + esc(item.id) + '">Excluir cadastro</button></div></form></section>';
  }
  function readyEditScreen() {
    const item = ready()[state.editReady];
    if (!item) return '<section class="screen active">' + empty('Geladinho não encontrado.') + '</section>';
    return '<section class="screen active">' + heading('Estoque produzido', 'Editar ' + item.name, 'Corrija quantidade, custo, preço e estoque mínimo em uma só tela.') + '<form id="readyEditForm" class="panel form-panel"><input type="hidden" name="recipeId" value="' + esc(item.recipeId) + '"><div class="form-grid two">' +
      field('Quantidade atual', '<input name="quantity" required inputmode="decimal" value="' + esc(String(item.quantity).replace('.', ',')) + '">') +
      field('Custo por unidade (R$)', '<input name="unitCost" required inputmode="decimal" value="' + esc(String(item.unitCost).replace('.', ',')) + '">') +
      field('Preço de venda (R$)', '<input name="saleUnitPrice" required inputmode="decimal" value="' + esc(String(item.saleUnitPrice).replace('.', ',')) + '">') +
      field('Estoque mínimo', '<input name="minimumStock" inputmode="decimal" value="' + esc(String(item.minimumStock).replace('.', ',')) + '">') +
      '</div><label class="form-field"><span>Motivo da correção de quantidade' + info('Obrigatório somente se a quantidade pronta for alterada. Fica registrado no histórico.', 'Ajuste de estoque') + '</span><textarea name="adjustmentReason" rows="2" placeholder="Ex.: conferência física, perda, degustação"></textarea></label><div class="button-row"><button class="primary">Salvar todas as alterações</button><button class="outline" type="button" data-route="stock:ready">Cancelar</button><button class="outline danger-button" type="button" data-action="delete-ready" data-id="' + esc(item.recipeId) + '">Excluir cadastro vazio</button></div></form></section>';
  }
  function recipeRows() {
    const list = activeSupplies().slice().sort((a, b) => a.name.localeCompare(b.name));
    return state.recipeLines.map((line, index) => '<div class="recipe-item"><select data-recipe-supply="' + index + '">' + options(list, line.supplyId, item => item.name + ' (' + item.unit + ')') + '</select><input data-recipe-quantity="' + index + '" inputmode="decimal" value="' + esc(line.quantity) + '" aria-label="Quantidade"><input data-recipe-unit="' + index + '" value="' + esc(line.unit) + '" aria-label="Unidade"><button class="line-remove" type="button" data-action="remove-recipe-line" data-index="' + index + '" aria-label="Remover ingrediente">×</button></div>').join('');
  }
  function recipeDraftFromScreen() {
    const form = $('#recipeForm');
    const f = form?.elements;
    return {
      id: form ? control(form, 'id')?.value || '' : '',
      name: form ? control(form, 'name')?.value || '' : '',
      productCategoryId: f?.productCategoryId?.value || productCategories()[0]?.id || 'gourmet',
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
    try { return recipeMetrics(candidate); } catch (_) { return null; }
  }
  function updateRecipePreview() {
    const cost = recipeDraftCost();
    const total = $('#recipePreview');
    const detailText = $('#recipeDetailPreview');
    const materials = $('#recipeMaterialsPreview');
    const labor = $('#recipeLaborPreview');
    const unitCost = $('#recipeUnitCostPreview');
    const profit = $('#recipeProfitPreview');
    const margin = $('#recipeMarginPreview');
    if (total) total.textContent = money(cost?.batchCost || 0);
    if (materials) materials.textContent = money(cost?.materialCost || 0);
    if (labor) labor.textContent = money(cost?.laborCost || 0);
    if (unitCost) unitCost.textContent = money(cost?.unitCost || 0);
    if (profit) profit.textContent = money(cost?.unitProfit || 0);
    if (margin) margin.textContent = cost ? cost.margin.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%' : '—';
    if (detailText) detailText.textContent = cost ? 'Materiais: ' + money(cost.materialCost) + ' · mão de obra: ' + money(cost.laborCost) + '. Lucro bruto = preço de venda − custo por unidade.' : 'Complete rendimento, item, quantidade e unidade para calcular.';
  }
  function recipeScreen() {
    const editing = state.editRecipe ? recipeById()[state.editRecipe] : null;
    if (editing && !state.recipeLinesLoaded) {
      state.recipeLines = editing.items.map(item => ({ ...item }));
      state.recipeDraft = { ...editing };
      state.recipeLinesLoaded = true;
    }
    const base = editing || state.recipeDraft || { name: '', productCategoryId: productCategories()[0]?.id || 'gourmet', yieldUnits: '', saleUnitPrice: '', laborAmount: '', laborMode: 'batch', preparation: '', description: '', active: true };
    const estimation = (() => {
      try {
        const candidate = { ...base, items: state.recipeLines.map(line => ({ supplyId: line.supplyId, quantity: n(line.quantity), unit: line.unit })).filter(line => line.supplyId && line.quantity > 0 && line.unit) };
        return candidate.items.length && n(candidate.yieldUnits) > 0 ? recipeMetrics(candidate) : null;
      } catch (_) { return null; }
    })();
    return '<section class="screen active">' + heading('Receitas', editing ? 'Editar receita' : 'Nova receita', 'Cadastre o sabor, os ingredientes, embalagens, modo de preparo e custo do lote.') + '<form id="recipeForm" class="panel form-panel"><input type="hidden" name="id" value="' + esc(editing?.id || '') + '"><div class="form-grid two">' +
      field('Nome do sabor', '<input name="name" required value="' + esc(base.name || '') + '" placeholder="Ex.: Ninho com Nutella">') +
      field('Categoria do geladinho', '<select name="productCategoryId">' + productCategories().map(category => '<option value="' + esc(category.id) + '"' + (categoryFor(base).id === category.id ? ' selected' : '') + '>' + esc(category.name) + '</option>').join('') + '</select>', 'Organiza o cardápio do cliente. Você pode criar e editar categorias em Cadastros › Categorias de geladinho. Não muda custo, rendimento ou estoque.') +
      field('Rendimento do lote (un.)', '<input name="yieldUnits" required inputmode="decimal" value="' + esc(base.yieldUnits || '') + '">', 'Quantidade de geladinhos que esta receita completa produz.') +
      field('Preço de venda por unidade (R$)', '<input name="saleUnitPrice" required inputmode="decimal" value="' + esc(String(base.saleUnitPrice || '').replace('.', ',')) + '">') +
      field('Mão de obra (R$)', '<input name="laborAmount" inputmode="decimal" value="' + esc(String(base.laborAmount || '').replace('.', ',')) + '">', 'Será incluída no custo do lote.') +
      field('Como calcular a mão de obra', '<select name="laborMode"><option value="batch"' + ((base.laborMode || 'batch') === 'batch' ? ' selected' : '') + '>Valor por lote</option><option value="unit"' + (base.laborMode === 'unit' ? ' selected' : '') + '>Valor por geladinho</option></select>') +
      field('Imagem do sabor', '<input name="image" type="file" accept="image/*">', 'Opcional. É usada somente no cardápio do cliente.') +
      '</div><label class="form-field"><span>Descrição para o cliente' + info('Esta descrição aparece no cardápio que você compartilha com os clientes.', 'Descrição do cardápio') + '</span><textarea name="description" rows="3" placeholder="Ex.: Creme de leite Ninho com recheio de Nutella.">' + esc(base.description || '') + '</textarea></label><div class="catalog-switch"><label><input name="active" type="checkbox"' + (base.active !== false ? ' checked' : '') + '> Disponível no cardápio</label><span>Sabores marcados como disponíveis aparecem no cardápio, inclusive quando o estoque está zerado. O cliente só consegue escolher quando houver produção pronta.</span></div><div class="section-line"><div><h3>Ingredientes e embalagens</h3><p>Na própria linha: selecione o item, informe a quantidade e a unidade.</p></div></div><div class="recipe-table-title"><span>Item</span><span>Quantidade</span><span>Unidade</span><span></span></div><div class="recipe-items">' + recipeRows() + '</div><button type="button" class="outline full" data-action="add-recipe-line">+ Adicionar item abaixo</button><label class="form-field"><span>Modo de preparo</span><textarea name="preparation" rows="5" placeholder="Explique o preparo passo a passo.">' + esc(base.preparation || '') + '</textarea></label><section class="recipe-cost-summary"><div><span>Custo dos materiais</span><b id="recipeMaterialsPreview">' + money(estimation?.materialCost || 0) + '</b></div><div><span>Mão de obra</span><b id="recipeLaborPreview">' + money(estimation?.laborCost || 0) + '</b></div><div><span>Custo total do lote</span><b id="recipePreview">' + money(estimation?.batchCost || 0) + '</b></div><div><span>Custo por geladinho</span><b id="recipeUnitCostPreview">' + money(estimation?.unitCost || 0) + '</b></div><div class="recipe-profit"><span>Lucro bruto por geladinho</span><b id="recipeProfitPreview">' + money(estimation?.unitProfit || 0) + '</b><small id="recipeMarginPreview">' + (estimation ? estimation.margin.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '% da venda' : '—') + '</small></div><small id="recipeDetailPreview">' + (estimation ? 'Preço de venda: ' + money(estimation.saleUnitPrice) + '. Materiais e mão de obra já estão incluídos no custo.' : 'Complete rendimento, item, quantidade e unidade para calcular.') + '</small></section><div class="button-row"><button class="primary">Salvar receita</button>' + (editing ? '<button class="outline" type="button" data-action="cancel-recipe-edit">Cancelar</button>' : '') + '</div></form></section>';
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
  function openingFinancialSummary() {
    const opening = openingFinancial();
    const configured = Boolean(opening.date || openingBalanceTotal() || n(opening.receivableTotal) || n(opening.payableTotal));
    if (!configured) return '<section class="panel"><h2>Fechamento inicial</h2><p class="form-note">Ainda não registrado. Use este fechamento para trazer o dinheiro e os valores pendentes que já existiam antes do app, sem cadastrar centenas de pedidos antigos.</p><button class="secondary" data-route="finance:opening">Registrar fechamento inicial</button></section>';
    return '<section class="panel"><div class="section-line"><div><h2>Fechamento inicial</h2><p>Base financeira de ' + brDate(opening.date) + '. Não entra no faturamento nem no lucro do app.</p></div><button class="outline" data-route="finance:opening">Editar</button></div><dl><dt>Saldo trazido para o app</dt><dd>' + money(openingBalanceTotal()) + '</dd><dt>Contas antigas a receber</dt><dd>' + money(opening.receivableRemaining) + '</dd><dt>Contas antigas a pagar</dt><dd>' + money(opening.payableRemaining) + '</dd></dl></section>';
  }
  function openingFinancialScreen() {
    const opening = openingFinancial();
    const received = round(opening.receipts.reduce((sum, item) => sum + n(item.total), 0));
    const paid = round(opening.payments.reduce((sum, item) => sum + n(item.total), 0));
    return '<section class="screen active">' + heading('Financeiro', 'Fechamento inicial', 'Traga a realidade da empresa para o app sem cadastrar as vendas antigas uma por uma.') + '<section class="panel"><p class="form-note"><b>Como preencher:</b> informe o que realmente existia na data escolhida, depois de todas as vendas e gastos anteriores. Esses números compõem o caixa e a conta, mas não entram no faturamento nem no lucro operacional.</p></section><form id="openingFinancialForm" class="panel form-panel"><div class="form-grid two">' +
      field('Data de início do controle', '<input name="date" required type="date" value="' + esc(opening.date || today()) + '">', 'É o dia a partir do qual as vendas e despesas passam a formar os relatórios do app.') +
      field('Dinheiro no caixa (R$)', '<input name="cash" inputmode="decimal" value="' + esc(String(n(opening.balances.Dinheiro)).replace('.', ',')) + '" placeholder="Ex.: 250,00">', 'Valor físico contado no caixa nessa data.') +
      field('Pix / saldo em conta (R$)', '<input name="pix" inputmode="decimal" value="' + esc(String(n(opening.balances.Pix)).replace('.', ',')) + '" placeholder="Ex.: 980,50">', 'Saldo disponível na conta da empresa.') +
      field('Crédito a receber (R$)', '<input name="credit" inputmode="decimal" value="' + esc(String(n(opening.balances.Crédito)).replace('.', ',')) + '" placeholder="Ex.: 120,00">', 'Vendas de cartão de crédito já feitas, mas ainda não depositadas.') +
      field('Débito a receber (R$)', '<input name="debit" inputmode="decimal" value="' + esc(String(n(opening.balances.Débito)).replace('.', ',')) + '" placeholder="Ex.: 80,00">', 'Vendas de débito já feitas, mas ainda não depositadas.') +
      field('Contas antigas a receber (R$)', '<input name="receivable" inputmode="decimal" value="' + esc(String(n(opening.receivableTotal)).replace('.', ',')) + '" placeholder="Ex.: 70,00">', 'Fiado, encomenda ou valor de cliente anterior ao app. Não conta como venda nova.') +
      field('Contas antigas a pagar (R$)', '<input name="payable" inputmode="decimal" value="' + esc(String(n(opening.payableTotal)).replace('.', ',')) + '" placeholder="Ex.: 55,00">', 'Dívida já existente com fornecedor ou outra conta antes do app.') +
      '</div><label class="form-field"><span>Observação</span><textarea name="note" rows="3" placeholder="Ex.: fechamento conferido com dinheiro físico e extrato bancário.">' + esc(opening.note) + '</textarea></label><section class="form-note"><b>Histórico já quitado:</b> ' + money(received) + ' de contas antigas recebidas e ' + money(paid) + ' de contas antigas pagas desde o fechamento.</section><div class="button-row"><button class="primary">Salvar fechamento inicial</button><button class="outline" type="button" data-route="finance:overview">Cancelar</button></div></form></section>';
  }
  function openingSettlementScreen(kind) {
    const opening = openingFinancial();
    const receiving = kind === 'receive';
    const remaining = receiving ? n(opening.receivableRemaining) : n(opening.payableRemaining);
    const title = receiving ? 'Receber conta antiga' : 'Pagar conta antiga';
    const description = receiving ? 'Registre a entrada de um valor que já existia antes do app. Isso aumenta o saldo por forma de pagamento, mas não vira faturamento novo.' : 'Registre o pagamento de uma dívida que já existia antes do app. Isso reduz o saldo por forma de pagamento, mas não vira despesa nova.';
    const back = receiving ? 'finance:receivable' : 'finance:payable';
    if (!(remaining > 0)) return '<section class="screen active">' + heading('Financeiro', title, 'Não há saldo antigo pendente para registrar.') + '<button class="outline" data-route="' + back + '">Voltar</button></section>';
    return '<section class="screen active">' + heading('Financeiro', title, description) + '<form id="openingSettlementForm" class="panel form-panel"><input type="hidden" name="kind" value="' + (receiving ? 'receive' : 'pay') + '"><div class="form-grid two">' +
      field('Valor (R$)', '<input name="total" required inputmode="decimal" placeholder="Até ' + esc(String(remaining).replace('.', ',')) + '">', 'Restante do saldo antigo: ' + money(remaining) + '.') +
      field(receiving ? 'Recebido por' : 'Pago com', '<select name="payment">' + METHODS.map(method => '<option' + (method === 'Pix' ? ' selected' : '') + '>' + method + '</option>').join('') + '</select>') +
      field('Data', '<input name="date" type="date" value="' + today() + '">') +
      '</div><label class="form-field"><span>Observação</span><input name="note" placeholder="Ex.: recebido da cliente Maria"></label><div class="button-row"><button class="primary">' + (receiving ? 'Registrar recebimento' : 'Registrar pagamento') + '</button><button class="outline" type="button" data-route="' + back + '">Cancelar</button></div></form></section>';
  }
  function financeScreen() {
    const view = state.screen.replace('finance-', '');
    const summary = finance();
    const balances = paymentBalances();
    if (view === 'opening') return openingFinancialScreen();
    if (view === 'opening-receive') return openingSettlementScreen('receive');
    if (view === 'opening-pay') return openingSettlementScreen('pay');
    if (state.editExpense) {
      const item = data.expenses.find(expense => String(expense.id) === String(state.editExpense));
      return '<section class="screen active">' + heading('Financeiro', 'Editar conta paga', 'Altere todos os dados de uma vez.') + (item ? expenseForm(item) : empty('Conta não encontrada.')) + '</section>';
    }
    if (view === 'receivable') {
      const opening = openingFinancial();
      const openingCard = n(opening.receivableRemaining) > 0 ? detail('Saldo anterior ao app', 'Fechamento de ' + brDate(opening.date) + ' · não é faturamento novo', money(opening.receivableRemaining), 'pendente', '<p class="form-note">Valor existente antes do início do controle.</p><div class="details-actions"><button class="primary" data-route="finance:opening-receive">Registrar recebimento</button><button class="outline" data-route="finance:opening">Ver fechamento</button></div>') : '';
      const orders = data.orders.filter(order => order.status === 'confirmed').sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate))).map(order => detail(order.customer, 'Vence em ' + brDate(order.dueDate) + ' · ' + esc(order.paymentMethod), money(order.total), 'pendente', '<div class="details-actions"><button class="primary" data-action="mark-paid" data-id="' + esc(order.id) + '">Marcar como pago</button><button class="outline" data-action="edit-order" data-id="' + esc(order.id) + '">Abrir pedido</button></div>')).join('');
      return '<section class="screen active">' + heading('Financeiro', 'Contas a receber', 'Pedidos confirmados que só entram no faturamento depois do pagamento.') + '<div class="list">' + (openingCard || '') + (orders || empty('Nenhum pedido aguardando pagamento.')) + '</div></section>';
    }
    if (view === 'payable') {
      const opening = openingFinancial();
      const openingCard = n(opening.payableRemaining) > 0 ? detail('Saldo anterior ao app', 'Fechamento de ' + brDate(opening.date) + ' · não é despesa nova', money(opening.payableRemaining), 'pendente', '<p class="form-note">Dívida existente antes do início do controle.</p><div class="details-actions"><button class="primary" data-route="finance:opening-pay">Registrar pagamento</button><button class="outline" data-route="finance:opening">Ver fechamento</button></div>') : '';
      const cards = data.expenses.filter(item => !item.voided).slice().sort((a, b) => String(b.date).localeCompare(String(a.date))).map(item => {
        const action = item.category === 'purchase' ? '<p class="form-note">Esta compra é corrigida pelo item de estoque.</p>' : '<div class="details-actions"><button class="outline" data-action="edit-expense" data-id="' + esc(item.id) + '">Editar</button><button class="outline danger-button" data-action="delete-expense" data-id="' + esc(item.id) + '">Anular</button></div>';
        return detail(item.name, brDate(item.date) + ' · ' + esc(item.paymentMethod), '− ' + money(item.total), item.category === 'purchase' ? 'compra' : 'paga', '<dl><dt>Data</dt><dd>' + brDate(item.date) + '</dd><dt>Pago com</dt><dd>' + esc(item.paymentMethod) + '</dd></dl>' + action);
      }).join('') || empty('Nenhuma conta paga registrada.');
      const voided = data.expenses.filter(item => item.voided).map(item => '<li><b>' + esc(item.name) + '</b><span>Anulada; permanece no histórico</span><button class="outline" data-action="restore-expense" data-id="' + esc(item.id) + '">Restaurar</button></li>').join('');
      return '<section class="screen active">' + heading('Financeiro', 'Contas pagas', 'Registre despesas operacionais. As compras de estoque entram automaticamente.') + expenseForm() + '<div class="list">' + (openingCard || '') + cards + '</div>' + (voided ? '<details class="panel archived-list"><summary>Contas anuladas</summary><ul>' + voided + '</ul></details>' : '') + '</section>';
    }
    return '<section class="screen active">' + heading('Financeiro', 'Visão financeira', 'Cada cartão leva para a parte correspondente.') + '<div class="dashboard-grid finance-metrics">' +
      metric('Faturamento', 'financeRevenue', 'Pedidos pagos', 'reports:finance') +
      metric('Custo vendido', 'financeCost', 'Produtos dos pedidos pagos', 'reports:finance') +
      metric('Taxas de cartão', 'financeFees', 'Taxas configuradas no pagamento', 'reports:finance') +
      metric('Custo de entrega', 'financeDelivery', 'Custo configurado por local', 'reports:finance') +
      metric('Despesas operacionais', 'financeExpense', 'Contas pagas', 'finance:payable') +
      metric('Lucro real', 'financeProfit', 'Receita − custos − taxas − despesas', 'reports:finance', true) +
      '</div><section class="panel balance-panel"><h2>Saldo por forma de pagamento</h2><div class="payment-balances"><span>Dinheiro <b>' + money(balances.Dinheiro) + '</b></span><span>Pix / conta <b>' + money(balances.Pix) + '</b></span><span>Crédito <b>' + money(balances.Crédito) + '</b></span><span>Débito <b>' + money(balances.Débito) + '</b></span></div></section>' + openingFinancialSummary() + '<section class="panel"><p class="form-note">Resultado atual: faturamento ' + money(summary.revenue) + ' − custo vendido ' + money(summary.cost) + ' − taxas ' + money(summary.paymentFee) + ' − custo de entrega ' + money(summary.deliveryCost) + ' − despesas operacionais ' + money(summary.expense) + '.</p></section></section>';
  }
  function orderDestination(order) {
    const mode = String(order.deliveryMode || order.mode || '').trim();
    const zone = String(order.deliveryZone || order.zoneName || '').trim();
    if (mode.toLocaleLowerCase('pt-BR').includes('entrega')) return zone || 'Entrega sem local informado';
    if (mode.toLocaleLowerCase('pt-BR').includes('retirada')) return 'Retirada';
    return zone || 'Não informado';
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
      if (state.reportFilter.location && row.location !== state.reportFilter.location) return false;
      return !query || String(row.search || '').toLocaleLowerCase('pt-BR').includes(query);
    };
    let rows = [];
    if (kind === 'orders') rows = data.orders.map(order => {
      const location = orderDestination(order);
      return { date: day(order.date), name: order.customer, items: order.items.map(line => line.productName).join(', '), payment: order.paymentMethod, status: orderStatus(order), location, address: String(order.address || '').trim(), value: n(order.total), search: order.customer + ' ' + location + ' ' + String(order.address || '') + ' ' + order.items.map(line => line.productName).join(' ') };
    });
    if (kind === 'finance') {
      const opening = openingFinancial();
      rows = data.orders.filter(order => order.status === 'paid').map(order => ({ date: day(order.paidAt || order.date), name: order.customer, type: 'Entrada', payment: order.paymentMethod, status: 'pago', value: n(order.total), cost: n(order.cost), search: order.customer + ' ' + order.items.map(line => line.productName).join(' ') }))
        .concat(data.expenses.map(item => ({ date: day(item.date), name: item.name, type: item.voided ? 'Saída anulada' : 'Saída', payment: item.paymentMethod, status: item.voided ? 'anulada' : item.category === 'purchase' ? 'compra' : 'paga', value: item.voided ? 0 : -n(item.total), cost: 0, search: item.name })))
        .concat(opening.receipts.map(item => ({ date: day(item.date), name: 'Recebimento de saldo anterior', type: 'Entrada anterior', payment: item.paymentMethod, status: 'saldo anterior', value: n(item.total), cost: 0, search: 'saldo anterior recebimento ' + item.note })))
        .concat(opening.payments.map(item => ({ date: day(item.date), name: 'Pagamento de saldo anterior', type: 'Saída anterior', payment: item.paymentMethod, status: 'saldo anterior', value: -n(item.total), cost: 0, search: 'saldo anterior pagamento ' + item.note })));
    }
    if (kind === 'stock') {
      data.supplies.forEach(item => item.movements.forEach(move => rows.push({ date: day(move.date), name: item.name, type: move.kind, quantity: n(move.quantity), unit: item.unit, payment: move.paymentMethod || '', status: '', value: n(move.total), search: item.name + ' ' + move.kind })));
      data.readyStock.forEach(item => item.movements.forEach(move => rows.push({ date: day(move.date), name: item.name, type: move.kind, quantity: n(move.quantity), unit: 'un.', payment: '', status: '', value: 0, search: item.name + ' ' + move.kind })));
    }
    return rows.filter(matches).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  }
  function reportCard(row, kind) {
    if (kind === 'orders') return detail(row.name, brDate(row.date) + ' · ' + esc(row.payment), money(row.value), row.status, '<p>' + esc(row.items) + '</p><p><b>Entrega / retirada:</b> ' + esc(row.location) + (row.address ? '<br><b>Endereço:</b> ' + esc(row.address).replace(/\n/g, '<br>') : '') + '</p>');
    if (kind === 'finance') return detail(row.name, brDate(row.date) + ' · ' + esc(row.payment), (row.value < 0 ? '− ' : '+ ') + money(Math.abs(row.value)), row.type.toLocaleLowerCase('pt-BR'), '<p>' + esc(row.type) + '</p>');
    return detail(row.name, brDate(row.date) + ' · ' + esc(row.type), (row.quantity >= 0 ? '+ ' : '− ') + Math.abs(row.quantity) + ' ' + esc(row.unit), 'estoque', '<p>Valor lançado: ' + money(row.value) + '</p>');
  }
  function reportsScreen() {
    const kind = state.screen.replace('reports-', '');
    const rows = reportRows(kind);
    let totalText = '', headings = [];
    if (kind === 'orders') {
      totalText = 'Pedidos: <b>' + rows.length + '</b> · valor: <b>' + money(rows.reduce((sum, row) => sum + row.value, 0)) + '</b> · recebidos: <b>' + money(rows.filter(row => row.status === 'pago').reduce((sum, row) => sum + row.value, 0)) + '</b>';
      const destinations = Object.entries(rows.reduce((all, row) => { all[row.location] = (all[row.location] || 0) + 1; return all; }, {})).sort((a, b) => b[1] - a[1]).slice(0, 3);
      if (destinations.length) totalText += '<br><span class="report-destinations">Mais pedidos por local: <b>' + destinations.map(item => esc(item[0]) + ' (' + item[1] + ')').join(' · ') + '</b></span>';
      headings = ['Data', 'Cliente', 'Itens', 'Entrega / retirada', 'Pagamento', 'Situação', 'Valor'];
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
      (kind === 'orders' ? field('Entrega / retirada', '<select data-filter="location"><option value="">Todos os locais</option>' + Array.from(new Set(data.orders.map(orderDestination))).sort((a, b) => a.localeCompare(b, 'pt-BR')).map(location => '<option value="' + esc(location) + '"' + (f.location === location ? ' selected' : '') + '>' + esc(location) + '</option>').join('') + '</select>') : '') +
      field('Situação', '<select data-filter="status"><option value="">Todas</option><option value="encomenda programada"' + (f.status === 'encomenda programada' ? ' selected' : '') + '>Encomenda programada</option><option value="em produção"' + (f.status === 'em produção' ? ' selected' : '') + '>Em produção</option><option value="aguardando aprovação"' + (f.status === 'aguardando aprovação' ? ' selected' : '') + '>Aguardando aprovação</option><option value="pendente"' + (f.status === 'pendente' ? ' selected' : '') + '>Pendente</option><option value="pago"' + (f.status === 'pago' ? ' selected' : '') + '>Pago</option><option value="cancelado"' + (f.status === 'cancelado' ? ' selected' : '') + '>Cancelado</option><option value="reserva expirada"' + (f.status === 'reserva expirada' ? ' selected' : '') + '>Reserva expirada</option></select>') +
      field('Buscar', '<input class="filter-search" data-filter="query" value="' + esc(f.query) + '" placeholder="Cliente, local, sabor, fornecedor...">') +
      '<button class="outline" type="button" data-action="clear-filter">Limpar</button><button class="secondary" type="button" data-action="export-xlsx">Baixar Excel</button></div><div class="panel report-summary">' + totalText + '</div><div class="list">' + (rows.map(row => reportCard(row, kind)).join('') || empty('Nenhum resultado encontrado.')) + '</div></section>';
  }
  function recipeViewScreen() {
    const recipe = recipeById()[state.viewRecipe];
    if (!recipe) return '<section class="screen active">' + heading('Receitas', 'Receita não encontrada', 'Ela pode ter sido excluída.') + '<button class="outline" data-route="records:catalog">Voltar ao cardápio</button></section>';
    let metrics = null, costError = '';
    try { metrics = recipeMetrics(recipe); } catch (error) { costError = error.message || 'Não foi possível calcular os custos desta receita.'; }
    const product = ready()[recipe.id];
    const ingredientRows = recipe.items.map(item => {
      const supply = supplies()[item.supplyId];
      const line = metrics?.lines.find(entry => String(entry.supplyId) === String(item.supplyId));
      return '<li><b>' + esc(supply?.name || 'Item removido') + '</b><span>' + qtyText(item.quantity) + ' ' + esc(item.unit || supply?.unit || '') + (line ? ' · ' + money(line.total) : '') + '</span></li>';
    }).join('') || '<li>Sem ingredientes cadastrados.</li>';
    const photo = recipe.imageData ? '<img class="recipe-view-image" src="' + esc(recipe.imageData) + '" alt="' + esc(recipe.name) + '">' : '';
    const financial = metrics
      ? '<section class="recipe-cost-summary view"><div><span>Preço de venda</span><b>' + money(metrics.saleUnitPrice) + '</b></div><div><span>Materiais / lote</span><b>' + money(metrics.materialCost) + '</b></div><div><span>Mão de obra / lote</span><b>' + money(metrics.laborCost) + '</b></div><div><span>Custo / geladinho</span><b>' + money(metrics.unitCost) + '</b></div><div class="recipe-profit"><span>Lucro bruto / geladinho</span><b>' + money(metrics.unitProfit) + '</b><small>' + metrics.margin.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '% do preço de venda</small></div><small>Lucro bruto: preço de venda − custo dos materiais e mão de obra. O lucro real da empresa também considera despesas e frete no Financeiro.</small></section>'
      : '<section class="panel caution"><b>Não foi possível calcular o custo.</b><p>' + esc(costError) + '</p></section>';
    return '<section class="screen active">' + heading('Receitas', recipe.name, 'Visualização da receita, do preparo e da rentabilidade por geladinho.') + '<section class="panel recipe-view">' + photo + '<p class="recipe-view-description">' + esc(recipe.description || 'Sem descrição para o cardápio.').replace(/\n/g, '<br>') + '</p><dl><dt>Categoria</dt><dd>' + esc(categoryFor(recipe).name) + '</dd><dt>Rendimento do lote</dt><dd>' + qtyText(recipe.yieldUnits) + ' geladinhos</dd><dt>Estoque produzido</dt><dd>' + qtyText(product?.quantity || 0) + ' un.</dd><dt>Status no cardápio</dt><dd>' + (recipe.active === false ? 'Oculto' : 'Disponível') + '</dd></dl></section>' + financial + '<section class="panel recipe-view"><h2>Ingredientes e embalagens</h2><ul class="recipe-view-items">' + ingredientRows + '</ul></section><section class="panel recipe-view"><h2>Modo de preparo</h2><p class="recipe-preparation">' + esc(recipe.preparation || 'Modo de preparo não cadastrado.').replace(/\n/g, '<br>') + '</p></section><div class="button-row"><button class="primary" data-action="edit-recipe" data-id="' + esc(recipe.id) + '">Editar receita</button><button class="outline" data-route="records:catalog">Voltar ao cardápio</button></div></section>';
  }
  function catalogScreen() {
    const cards = data.recipes.slice().sort((a, b) => a.name.localeCompare(b.name)).map(recipe => {
      const product = ready()[recipe.id];
      const quantity = product ? round(product.quantity) : 0;
      const source = 'Categoria: ' + categoryFor(recipe).name + ' · ' + (product ? 'em estoque: ' + quantity + ' un.' : 'ainda não foi produzido');
      const photo = recipe.imageData ? '<div class="customer-preview"><img src="' + esc(recipe.imageData) + '" alt=""></div>' : '';
      let metrics = null;
      try { metrics = recipeMetrics(recipe); } catch (_) { /* A visualização explicará o item que falta. */ }
      const profit = metrics ? '<p class="recipe-card-profit"><b>Lucro bruto por geladinho:</b> ' + money(metrics.unitProfit) + ' · ' + metrics.margin.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%</p>' : '<p class="form-note">Complete os custos para calcular o lucro por geladinho.</p>';
      return detail(recipe.name, source, money(recipe.saleUnitPrice), recipe.active === false ? 'oculto' : 'ativo', '<p>' + esc(recipe.description || 'Sem descrição para o cliente.').replace(/\n/g, '<br>') + '</p>' + photo + profit + '<p class="form-note">Sabor ativo aparece no cardápio mesmo sem estoque; quando estiver zerado, o cliente vê “esgotado” e não consegue selecionar.</p><div class="details-actions"><button class="secondary" data-action="view-recipe" data-id="' + esc(recipe.id) + '">Visualizar receita</button><button class="outline" data-action="edit-recipe" data-id="' + esc(recipe.id) + '">Editar sabor</button><button class="outline" data-action="toggle-catalog" data-id="' + esc(recipe.id) + '">' + (recipe.active === false ? 'Mostrar no cardápio' : 'Ocultar do cardápio') + '</button><button class="outline danger-button" data-action="delete-recipe" data-id="' + esc(recipe.id) + '">Excluir receita</button></div>');
    }).join('') || empty('Ainda não há sabores cadastrados.');
    return '<section class="screen active">' + heading('Cadastros', 'Cardápio e sabores', 'Cadastre, visualize e edite aqui os sabores que podem ser produzidos. Este é o cardápio usado pelo link do cliente.') + '<div class="isolated-actions"><button class="primary" data-action="new-recipe">Cadastrar novo sabor</button><button class="secondary" data-action="copy-catalog-link">Gerar link para o cliente</button></div><section class="panel"><p class="form-note">Todo sabor ativo aparece no cardápio do cliente. A quantidade disponível vem do Estoque produzido; com zero, ele fica visível como esgotado e sem seleção.</p></section><div class="list">' + cards + '</div></section>';
  }
  function categoryRecipesMarkup(category, entries) {
    const recipes = entries.slice().sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    if (!recipes.length) return '<section class="category-recipes empty-category"><p>Nenhum sabor foi cadastrado nesta categoria ainda.</p><button class="primary" data-action="new-recipe-category" data-id="' + esc(category.id) + '">Cadastrar o primeiro sabor</button></section>';
    const rows = recipes.map(recipe => {
      const product = ready()[recipe.id];
      const stock = n(product?.quantity);
      const stockText = stock > 0 ? qtyText(stock) + ' un. prontas' : 'Sem unidades prontas';
      const visibility = recipe.active === false ? 'Oculto do cardápio' : 'No cardápio';
      return '<li><div class="category-recipe-copy"><b>' + esc(recipe.name) + '</b><span>' + money(recipe.saleUnitPrice) + ' · ' + esc(stockText) + '</span></div><div class="category-recipe-meta"><em class="category-visibility ' + (recipe.active === false ? 'hidden' : 'visible') + '">' + visibility + '</em><div class="category-recipe-actions"><button class="secondary" data-action="view-recipe" data-id="' + esc(recipe.id) + '">Ver</button><button class="outline" data-action="edit-recipe" data-id="' + esc(recipe.id) + '">Editar</button></div></div></li>';
    }).join('');
    return '<section class="category-recipes"><div class="category-recipes-heading"><h4>Sabores nesta categoria</h4><button class="outline" data-action="new-recipe-category" data-id="' + esc(category.id) + '">Adicionar sabor</button></div><ul>' + rows + '</ul></section>';
  }
  function categoryScreen() {
    const cards = productCategories().map(category => {
      const recipes = data.recipes.filter(recipe => categoryFor(recipe).id === category.id).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
      const active = recipes.filter(recipe => recipe.active !== false).length;
      const names = recipes.length ? 'Sabores: ' + recipes.map(recipe => esc(recipe.name)).join(' · ') : 'Nenhum sabor cadastrado nesta categoria.';
      return detail(category.name, names, active + (active === 1 ? ' ativo' : ' ativos'), 'categoria', '<p class="form-note">Esta categoria organiza os sabores no cardápio do cliente. Ela não altera custo, receita, produção ou estoque.</p>' + categoryRecipesMarkup(category, recipes) + '<div class="details-actions"><button class="outline" data-action="edit-category" data-id="' + esc(category.id) + '">Editar categoria</button><button class="outline danger-button" data-action="delete-category" data-id="' + esc(category.id) + '">Excluir categoria</button></div>');
    }).join('') || empty('Cadastre pelo menos uma categoria para organizar o cardápio.');
    return '<section class="screen active">' + heading('Cadastros', 'Categorias de geladinho', 'Crie, consulte e edite as divisões do cardápio. Cada categoria mostra os sabores, estoque e situação de cada item.') + '<form id="categoryForm" class="panel form-panel"><div class="form-grid two">' + field('Nome da categoria', '<input name="name" required placeholder="Ex.: Geladinho de água">', 'Exemplos iniciais: geladinho de água, geladinho de leite e geladinho gourmet.') + '</div><button class="primary full">Cadastrar categoria</button></form><section class="panel"><p class="form-note">Para excluir uma categoria, primeiro altere as receitas que ainda usam essa categoria. Assim nenhum sabor fica sem identificação.</p></section><div class="list">' + cards + '</div></section>';
  }
  function categoryEditScreen() {
    const category = productCategories().find(item => String(item.id) === String(state.editProductCategory));
    if (!category) return '<section class="screen active">' + empty('Categoria não encontrada.') + '</section>';
    const recipes = data.recipes.filter(recipe => categoryFor(recipe).id === category.id);
    const usedBy = recipes.length;
    return '<section class="screen active">' + heading('Cadastros', 'Editar categoria', 'O novo nome aparece nas receitas e no cardápio, sem alterar custos ou estoque.') + '<form id="categoryEditForm" class="panel form-panel"><input type="hidden" name="id" value="' + esc(category.id) + '">' + field('Nome da categoria', '<input name="name" required value="' + esc(category.name) + '">') + '<p class="form-note">Esta categoria está sendo usada por ' + usedBy + (usedBy === 1 ? ' receita.' : ' receitas.') + '</p><div class="button-row"><button class="primary">Salvar alterações</button><button class="outline" type="button" data-route="records:categories">Cancelar</button><button class="outline danger-button" type="button" data-action="delete-category" data-id="' + esc(category.id) + '">Excluir categoria</button></div></form><section class="panel category-members-panel">' + categoryRecipesMarkup(category, recipes) + '</section></section>';
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
  function purchaseHistory(item) {
    if (!item) return [];
    const recorded = data.purchases.filter(purchase => String(purchase.supplyId) === String(item.id));
    const source = recorded.length ? recorded : (item.movements || []).filter(move => move.kind === 'Compra');
    return source.map(entry => {
      const quantity = n(entry.quantity);
      const total = n(entry.total);
      const unitPrice = n(entry.unitPrice) || (quantity > 0 ? round(total / quantity) : 0);
      return {
        id: entry.id || uid(), date: entry.date || '', quantity, total, unitPrice,
        supplierId: entry.supplierId || '', supplierName: entry.supplierName || item.lastSupplierName || 'Fornecedor não informado',
        paymentMethod: entry.paymentMethod || ''
      };
    }).filter(entry => entry.quantity > 0 && entry.unitPrice >= 0).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  }
  function purchaseStats(item) {
    const history = purchaseHistory(item);
    const priced = history.filter(entry => entry.unitPrice > 0);
    const quantity = priced.reduce((sum, entry) => sum + entry.quantity, 0);
    const total = priced.reduce((sum, entry) => sum + entry.total, 0);
    const lowestEntry = priced.slice().sort((a, b) => a.unitPrice - b.unitPrice || String(b.date).localeCompare(String(a.date)))[0] || null;
    const highestEntry = priced.slice().sort((a, b) => b.unitPrice - a.unitPrice || String(b.date).localeCompare(String(a.date)))[0] || null;
    const suppliers = Object.values(priced.reduce((groups, entry) => {
      const key = entry.supplierId || entry.supplierName;
      if (!groups[key]) groups[key] = { name: entry.supplierName, purchases: [], quantity: 0, total: 0 };
      groups[key].purchases.push(entry);
      groups[key].quantity += entry.quantity;
      groups[key].total += entry.total;
      return groups;
    }, {})).map(group => ({
      ...group,
      average: group.quantity ? round(group.total / group.quantity) : 0,
      lowest: Math.min(...group.purchases.map(entry => entry.unitPrice)),
      latest: group.purchases.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)))[0]
    })).sort((a, b) => a.lowest - b.lowest || a.name.localeCompare(b.name, 'pt-BR'));
    return { history, priced, quantity, total, latest: history[0] || null, lowestEntry, highestEntry, weightedAverage: quantity ? round(total / quantity) : 0, suppliers };
  }
  function priceDecision(stats, proposedPrice, plannedQuantity) {
    if (!(proposedPrice > 0) || !stats.lowestEntry) return null;
    const best = stats.lowestEntry.unitPrice;
    const difference = round(proposedPrice - best);
    const percentage = best > 0 ? round(difference / best * 100) : 0;
    const amount = plannedQuantity > 0 ? round(difference * plannedQuantity) : 0;
    let level = 'neutral';
    let title = 'Preço dentro do histórico';
    if (difference <= 0) { level = 'good'; title = difference < 0 ? 'Melhor preço já registrado' : 'Empata com o melhor preço registrado'; }
    else if (proposedPrice <= stats.weightedAverage) { level = 'good'; title = 'Abaixo da sua média histórica'; }
    else if (stats.highestEntry && proposedPrice > stats.highestEntry.unitPrice) { level = 'warn'; title = 'Maior preço já registrado'; }
    else { level = 'warn'; title = 'Acima da sua média histórica'; }
    return { best, difference, percentage, amount, level, title };
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
    const plannedQuantity = n(state.compareQuantity);
    const stats = purchaseStats(item);
    const decision = priceDecision(stats, price, plannedQuantity);
    const summary = item && stats.priced.length
      ? '<section class="purchase-metrics"><div><span>Última compra</span><b>' + money(stats.latest.unitPrice) + '</b><small>' + brDate(stats.latest.date) + ' · ' + esc(stats.latest.supplierName) + '</small></div><div><span>Menor preço</span><b>' + money(stats.lowestEntry.unitPrice) + '</b><small>' + esc(stats.lowestEntry.supplierName) + ' · ' + brDate(stats.lowestEntry.date) + '</small></div><div><span>Média das compras</span><b>' + money(stats.weightedAverage) + '</b><small>média ponderada por quantidade</small></div><div><span>Maior preço</span><b>' + money(stats.highestEntry.unitPrice) + '</b><small>' + esc(stats.highestEntry.supplierName) + ' · ' + brDate(stats.highestEntry.date) + '</small></div><div><span>Custo do estoque atual</span><b>' + money(item.averageUnitCost) + '</b><small>média do que ainda está armazenado</small></div><div><span>Histórico</span><b>' + stats.priced.length + '</b><small>' + stats.suppliers.length + (stats.suppliers.length === 1 ? ' fornecedor' : ' fornecedores') + ' comparados</small></div></section>'
      : item ? '<section class="panel caution"><b>Ainda não há compras com preço para comparar.</b><p>Lance a compra deste item com quantidade e total pago. A partir da primeira compra, esta tela mostrará o histórico e a melhor oferta.</p></section>' : '<section class="panel"><p>Escolha um ingrediente ou insumo para consultar o histórico de compras.</p></section>';
    const decisionMarkup = decision
      ? '<section class="price-decision ' + decision.level + '"><strong>' + esc(decision.title) + '</strong><span>Preço visto: ' + money(price) + ' / ' + esc(item.unit) + ' · melhor registrado: ' + money(decision.best) + ' / ' + esc(item.unit) + '.</span><b>' + (decision.difference <= 0 ? 'Economia de ' + money(Math.abs(decision.difference)) + ' por ' + esc(item.unit) : 'Diferença de ' + money(decision.difference) + ' por ' + esc(item.unit) + ' (' + decision.percentage.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '% acima do melhor preço)') + '</b>' + (plannedQuantity > 0 ? '<small>' + (decision.amount > 0 ? 'Para ' + qtyText(plannedQuantity) + ' ' + esc(item.unit) + ', custará ' + money(decision.amount) + ' a mais que a melhor compra registrada.' : 'Para ' + qtyText(plannedQuantity) + ' ' + esc(item.unit) + ', a economia estimada é de ' + money(Math.abs(decision.amount)) + ' em relação à melhor compra registrada.') + '</small>' : '') + '</section>'
      : '<section class="comparison-result"><strong>Consulta de mercado</strong><span>Informe o preço que encontrou para saber se vale a pena comprar.</span></section>';
    const supplierRows = stats.suppliers.length ? '<section class="panel price-history"><h2>Por fornecedor</h2><div class="price-table">' + stats.suppliers.map(supplier => '<div><span><b>' + esc(supplier.name) + '</b><small>' + supplier.purchases.length + (supplier.purchases.length === 1 ? ' compra' : ' compras') + ' · última em ' + brDate(supplier.latest.date) + '</small></span><span>Melhor: <b>' + money(supplier.lowest) + '</b><small>Média: ' + money(supplier.average) + '</small></span></div>').join('') + '</div></section>' : '';
    const historyRows = stats.history.length ? '<section class="panel price-history"><h2>Histórico de compras</h2><p class="form-note">A comparação é válida quando a unidade de medida é a mesma para esse item.</p><div class="price-table">' + stats.history.slice(0, 15).map(entry => '<div><span><b>' + brDate(entry.date) + '</b><small>' + esc(entry.supplierName) + ' · ' + qtyText(entry.quantity) + ' ' + esc(item.unit) + '</small></span><span><b>' + money(entry.unitPrice) + ' / ' + esc(item.unit) + '</b><small>Total: ' + money(entry.total) + '</small></span></div>').join('') + '</div></section>' : '';
    return '<section class="screen active">' + heading('Ferramentas', 'Preços e compras', 'Consulte o histórico antes de comprar e veja onde vocês pagaram menos por cada item.') + '<form id="compareForm" class="panel form-panel"><div class="form-grid two">' + field('Item', '<select name="supplyId">' + options(data.supplies.slice().sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')), state.compareSupply || '') + '</select>', 'Escolha o mesmo item e unidade cadastrados no estoque.') + field('Preço visto (R$) por ' + esc(item?.unit || 'unidade'), '<input name="unitPrice" inputmode="decimal" value="' + esc(state.comparePrice || '') + '" placeholder="Ex.: 2,99">', 'Preço de uma unidade, não o total da compra.') + field('Quantidade que pretende comprar', '<input name="quantity" inputmode="decimal" value="' + esc(state.compareQuantity || '') + '" placeholder="Opcional">', 'Usamos este campo para mostrar quanto você economiza ou paga a mais no total.') + '</div><button class="primary full">Analisar preço</button></form>' + summary + decisionMarkup + supplierRows + historyRows + '</section>';
  }
  function deliveryZoneRows(value) {
    return String(value || '').split(/\r?\n/).map(line => {
      const [city, fee = '', deliveryCost = ''] = line.split('|');
      return { city: String(city || '').trim(), fee: String(fee || '').trim(), deliveryCost: String(deliveryCost || '').trim() };
    }).filter(row => row.city || row.fee || row.deliveryCost);
  }
  function defaultDeliveryDraft() {
    return {
      deliveryModes: data.settings.deliveryModes || 'Retirada,Entrega',
      pickupAddress: data.settings.pickupAddress || '',
      freeDeliveryMinValue: data.settings.freeDeliveryMinValue || '',
      freeDeliveryMinItems: data.settings.freeDeliveryMinItems || '',
      creditFeePercent: data.settings.creditFeePercent || '',
      debitFeePercent: data.settings.debitFeePercent || '',
      reservationMinutes: data.settings.reservationMinutes || '20',
      zones: deliveryZoneRows(data.settings.deliveryZones)
    };
  }
  function deliveryDraftFromForm(form) {
    if (!form) return state.deliveryDraft || defaultDeliveryDraft();
    const f = form.elements;
    return {
      deliveryModes: f.deliveryModes.value,
      pickupAddress: f.pickupAddress.value,
      freeDeliveryMinValue: f.freeDeliveryMinValue.value,
      freeDeliveryMinItems: f.freeDeliveryMinItems.value,
      creditFeePercent: f.creditFeePercent.value,
      debitFeePercent: f.debitFeePercent.value,
      reservationMinutes: f.reservationMinutes.value,
      zones: Array.from(form.querySelectorAll('[data-delivery-zone]')).map(row => ({
        city: row.querySelector('[data-zone-city]')?.value.trim() || '',
        fee: row.querySelector('[data-zone-fee]')?.value.trim() || '',
        deliveryCost: row.querySelector('[data-zone-cost]')?.value.trim() || ''
      }))
    };
  }
  function deliveryZoneFields(draft) {
    const rows = draft.zones.length ? draft.zones : [{ city: '', fee: '', deliveryCost: '' }];
    return '<section class="delivery-zones"><h2>Locais, frete e custo da entrega</h2><p class="form-note">O frete é o valor que o cliente paga. O custo é o que a empresa paga ao entregador; deixe em branco se não houver custo fixo.</p>' + rows.map((row, index) => '<div class="delivery-zone-row" data-delivery-zone><label>Cidade ou bairro<input data-zone-city="' + index + '" value="' + esc(row.city) + '" placeholder="Ex.: Águas do Centro"></label><label>Frete cobrado (R$)<input data-zone-fee="' + index + '" inputmode="decimal" value="' + esc(row.fee) + '" placeholder="Ex.: 5,00"></label><label>Custo da entrega (R$)<input data-zone-cost="' + index + '" inputmode="decimal" value="' + esc(row.deliveryCost) + '" placeholder="Ex.: 3,00"></label><button class="line-remove" type="button" data-action="remove-delivery-zone" data-index="' + index + '" aria-label="Remover local">×</button></div>').join('') + '<button class="outline full" type="button" data-action="add-delivery-zone">+ Adicionar cidade ou bairro</button></section>';
  }
  function settingsScreen() {
    const section = state.screen.replace('settings-', '');
    if (section === 'cloud') {
      const signedIn = window.GelatosCloud?.hasSession();
      const synced = cloudRevision !== null;
      if (!signedIn) return '<section class="screen active">' + heading('Bem-vinda de volta', 'Entre para carregar sua empresa', 'Como este é um novo endereço do aplicativo, entre uma vez com o mesmo acesso usado anteriormente. Seus pedidos, estoque e financeiro continuam guardados na nuvem.') + '<form id="cloudAuthForm" class="panel form-panel"><h2>Acesso da Gelatos Lele</h2>' + field('E-mail usado no Gelatos Lele', '<input name="email" type="email" autocomplete="email" required placeholder="voce@exemplo.com">') + field('Senha do Gelatos Lele', '<input name="password" type="password" autocomplete="current-password" minlength="8" required>', 'Use a senha criada para entrar no Gelatos Lele. Não é a senha do GitHub ou do banco de dados.') + '<div class="button-row"><button class="primary" name="cloudMode" value="signin">Carregar minha empresa</button><button class="outline" name="cloudMode" value="signup">Criar acesso novo</button></div><p class="form-note">Use “Criar acesso novo” somente se sua empresa ainda não tinha sincronização. Após entrar, os dados cadastrados voltarão automaticamente.</p></form></section>';
      return '<section class="screen active">' + heading('Configurações', 'Nuvem e sincronização', synced ? 'Sua empresa está sincronizada. Alterações feitas em um celular aparecem no outro.' : 'Ative a empresa e envie os dados deste celular uma única vez.') + '<section class="panel"><h2>Acesso conectado</h2><p>' + esc(window.GelatosCloud.email() || 'E-mail conectado') + '</p><span class="badge ' + (synced ? 'paid' : 'pending') + '">' + (synced ? 'sincronizado' : 'aguardando ativação') + '</span></section>' + (synced ? '<section class="panel"><p>Os dados ficam neste celular e na nuvem. Quando houver internet, alterações e pedidos do cardápio são atualizados automaticamente.</p><div class="button-row"><button class="secondary" data-action="cloud-refresh">Atualizar agora</button><button class="outline" data-action="cloud-signout">Sair deste celular</button></div></section>' : '<form id="cloudActivateForm" class="panel form-panel"><h2>Ativar e migrar os dados</h2>' + field('Código de ativação', '<input name="activationCode" required autocomplete="off" placeholder="Código recebido no atendimento">', 'Use o código único fornecido para esta primeira ativação. Depois dele, só quem entrar com seu e-mail e senha terá acesso.') + '<button class="primary full">Ativar empresa e enviar dados deste celular</button><p class="form-note">Faça isto no celular que já tem os cadastros corretos. Os dados atuais não serão apagados.</p></form>') + '</section>';
    }
    if (section === 'team') {
      const members = Array.isArray(state.teamMembers) ? state.teamMembers : [];
      const list = members.length
        ? '<div class="list">' + members.map(member => detail(member.email || 'Conta sem e-mail', member.role === 'owner' ? 'Proprietária' : member.role === 'manager' ? 'Gestão' : member.role === 'production' ? 'Produção' : member.role === 'sales' ? 'Vendas' : 'Consulta', '', 'acesso', member.role === 'owner' ? '<p class="form-note">A proprietária mantém o controle total da empresa.</p>' : '<div class="details-actions"><button class="outline danger-button" data-action="remove-member" data-id="' + esc(member.userId) + '">Remover acesso</button></div>')).join('') + '</div>'
        : '<section class="panel"><p>Nenhum acesso adicional cadastrado ainda.</p></section>';
      return '<section class="screen active">' + heading('Configurações', 'Equipe e acessos', 'Convide pessoas que já criaram acesso no Gelatos Lele. Apenas a proprietária pode incluir ou remover pessoas.') + '<form id="teamMemberForm" class="panel form-panel">' + field('E-mail da pessoa', '<input name="email" type="email" required autocomplete="email" placeholder="pessoa@exemplo.com">', 'A pessoa deve primeiro tocar em “Criar acesso novo” neste mesmo aplicativo. Depois use o mesmo e-mail aqui.') + field('Papel inicial', '<select name="role"><option value="manager">Gestão</option><option value="production">Produção</option><option value="sales">Vendas</option><option value="viewer">Consulta</option></select>', 'Nesta primeira versão, Gestão pode alterar dados; os demais papéis ficam preparados para permissões específicas na próxima etapa.') + '<button class="primary full">Liberar acesso</button></form>' + (state.teamError ? '<section class="panel caution"><b>Não foi possível atualizar a equipe.</b><p>' + esc(state.teamError) + '</p></section>' : '') + '<section class="panel"><h2>Pessoas com acesso</h2><p class="form-note">Cada pessoa deve usar seu próprio e-mail e senha. Não compartilhem a senha da proprietária.</p></section>' + list + '</section>';
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
        field('Mensagem do WhatsApp', '<textarea name="whatsappTemplate" rows="9">' + esc(data.settings.whatsappTemplate) + '</textarea>', 'Campos que você pode usar: {nome}, {itens}, {total}, {pix} e {data_entrega}. Em pedido de um sabor, {itens} mostra somente quantidade e sabor; em pedidos com mais sabores, mostra também o total de cada linha.') +
        '<section class="message-fields"><h2>Campos disponíveis</h2><button type="button" data-action="info" data-info-title="Campo {nome}" data-info-text="Nome do cliente informado no pedido.">{nome}</button><button type="button" data-action="info" data-info-title="Campo {itens}" data-info-text="Lista dos sabores e quantidades. Em pedido com mais de um sabor, inclui o total de cada linha.">{itens}</button><button type="button" data-action="info" data-info-title="Campo {total}" data-info-text="Valor total de todo o pedido.">{total}</button><button type="button" data-action="info" data-info-title="Campo {pix}" data-info-text="Chave Pix cadastrada nesta tela.">{pix}</button><button type="button" data-action="info" data-info-title="Campo {data_entrega}" data-info-text="Na encomenda, mostra a data combinada. Nos demais pedidos, mostra a data do pedido.">{data_entrega}</button></section><button class="primary full">Salvar mensagem</button></form></section>';
    }
    if (section === 'catalog') {
      const link = catalogLink();
      return '<section class="screen active">' + heading('Configurações', 'Cardápio do cliente', 'Configure as informações do link que mostra os sabores cadastrados em Cadastros › Cardápio / sabores.') + '<form id="catalogSettingsForm" class="panel form-panel">' +
        field('Nome exibido no cardápio', '<input name="catalogName" value="' + esc(data.settings.catalogName || 'Gelatos Lele') + '" placeholder="Ex.: Gelatos Lele">', 'Título que o cliente vê no topo do cardápio.') +
        field('Logo exibida no cardápio', '<input name="catalogLogo" type="file" accept="image/*">', 'Opcional. Se não escolher uma imagem, o cardápio usa a logo do cabeçalho; se ela também não existir, usa a marca padrão.') +
        field('Texto de apresentação', '<textarea name="catalogIntro" rows="3">' + esc(data.settings.catalogIntro || '') + '</textarea>', 'O cliente lê este texto ao abrir o cardápio.') +
        field('WhatsApp da empresa', '<input name="catalogPhone" inputmode="tel" value="' + esc(data.settings.catalogPhone || '') + '">', 'É usado se o celular não tiver a opção de compartilhar disponível.') +
        field('Endereço / instruções', '<textarea name="businessAddress" rows="3">' + esc(data.settings.businessAddress || '') + '</textarea>', 'Ex.: retirada no endereço, horário ou taxa de entrega.') +
        '<section class="panel nested-panel"><h2>Encomendas agendadas</h2><p class="form-note">A encomenda não baixa o estoque pronto no momento do pedido. Ela fica programada para você produzir, reservar os itens e confirmar.</p><label class="catalog-switch"><input name="scheduledEnabled" type="checkbox"' + (data.settings.scheduledEnabled !== false ? ' checked' : '') + '> Permitir encomendas no cardápio</label><div class="form-grid two">' + field('Prazo mínimo (dias)', '<input name="scheduledLeadDays" inputmode="numeric" value="' + esc(data.settings.scheduledLeadDays || '2') + '" placeholder="Ex.: 2">', 'O cliente só poderá escolher datas a partir deste número de dias. O mínimo do sistema é 2 dias.') + field('Limite por data (geladinhos)', '<input name="scheduledMaxItemsPerDay" inputmode="decimal" value="' + esc(data.settings.scheduledMaxItemsPerDay || '') + '" placeholder="Deixe em branco para não limitar">', 'Evita aceitar mais encomendas do que a produção comporta em um mesmo dia. Soma todos os pedidos agendados ativos para a data.') + '</div></section>' +
        '<button class="primary full">Salvar informações do cardápio</button></form><section class="panel"><h2>Link para enviar ao cliente</h2><p>Pronta entrega mostra somente o que já foi produzido. Encomenda mostra os sabores ativos e pede uma data com o prazo mínimo configurado.</p><div class="customer-link"><input readonly value="' + esc(link) + '"><button class="secondary" type="button" data-action="copy-catalog-link">Copiar link</button></div><p class="form-note">Com a nuvem ativada, os pedidos entram diretamente no Controle de pedidos.</p></section></section>';
    }
    if (section === 'delivery') {
      const draft = state.deliveryDraft || (state.deliveryDraft = defaultDeliveryDraft());
      return '<section class="screen active">' + heading('Configurações', 'Frete e entrega', 'Crie os locais de entrega e o respectivo frete. O cliente escolhe um local no cardápio e o total é calculado na hora.') + '<form id="deliverySettingsForm" class="panel form-panel">' +
        field('Formas de receber', '<input name="deliveryModes" value="' + esc(draft.deliveryModes) + '">', 'Separe as opções por vírgula. Ex.: Retirada,Entrega.') +
        field('Endereço para retirada', '<textarea name="pickupAddress" rows="3" placeholder="Ex.: Rua das Flores, 123 — Centro">' + esc(draft.pickupAddress) + '</textarea>', 'Aparece ao cliente somente quando ele escolher Retirada. Inclua endereço, horário e ponto de referência se desejar.') +
        deliveryZoneFields(draft) +
        '<section class="panel nested-panel"><h2>Taxas de cartão</h2><p class="form-note">Essas taxas são descontadas do lucro e do saldo esperado de Crédito/Débito. Deixe em branco ou zero se não quiser calcular agora.</p><div class="form-grid two">' + field('Taxa de crédito (%)', '<input name="creditFeePercent" inputmode="decimal" value="' + esc(draft.creditFeePercent) + '" placeholder="Ex.: 3,49">') + field('Taxa de débito (%)', '<input name="debitFeePercent" inputmode="decimal" value="' + esc(draft.debitFeePercent) + '" placeholder="Ex.: 1,99">') + '</div></section>' +
        field('Tempo da reserva do cliente (minutos)', '<input name="reservationMinutes" inputmode="numeric" value="' + esc(draft.reservationMinutes) + '" placeholder="Ex.: 20">', 'Pedido enviado pelo cardápio reserva o estoque apenas por este tempo, até você aprovar. Use de 5 a 120 minutos.') +
        field('Frete grátis acima de valor (R$)', '<input name="freeDeliveryMinValue" inputmode="decimal" value="' + esc(draft.freeDeliveryMinValue) + '" placeholder="Ex.: 50,00">', 'Deixe em branco se não quiser esta regra. O frete fica grátis quando o subtotal dos geladinhos atingir este valor.') +
        field('Frete grátis acima de quantidade', '<input name="freeDeliveryMinItems" inputmode="decimal" value="' + esc(draft.freeDeliveryMinItems) + '" placeholder="Ex.: 10">', 'Deixe em branco se não quiser esta regra. O frete fica grátis quando a quantidade total atingir este número.') +
        '<button class="primary full">Salvar frete e entrega</button></form><section class="panel"><h2>Como o cliente verá</h2><p>Ao escolher Entrega, ele seleciona o local e vê subtotal, frete e total antes de enviar o pedido.</p></section></section>';
    }
    if (section === 'backup') {
      const serverRows = Array.isArray(state.serverBackups)
        ? (state.serverBackups.length ? '<div class="list">' + state.serverBackups.map(item => detail('Cópia de ' + brDate(item.snapshotDate), 'Gerada em ' + brDateTime(item.savedAt), 'revisão ' + item.revision, 'nuvem', '<div class="details-actions"><button class="outline danger-button" data-action="restore-server-backup" data-id="' + esc(item.snapshotDate) + '">Restaurar esta versão</button></div>')).join('') + '</div>' : '<p class="form-note">A primeira cópia diária será criada na próxima alteração salva na nuvem.</p>')
        : '<p class="form-note">Carregando versões da nuvem…</p>';
      return '<section class="screen active">' + heading('Configurações', 'Backup dos dados', 'Salve uma cópia antes de trocar de celular ou fazer alterações grandes.') + '<section class="panel"><h2>Cópia deste aparelho</h2><p>O arquivo inclui receitas, estoque, compras, pedidos, financeiro e configurações.</p><div class="button-row"><button class="secondary" data-action="backup">Baixar backup</button><button class="outline" data-action="restore">Restaurar arquivo</button></div><input id="restoreFile" type="file" accept="application/json" hidden></section><section class="panel"><h2>Histórico seguro da nuvem</h2><p>Guardamos uma cópia diária antes das alterações. Restaurar uma versão também preserva uma cópia do estado atual.</p>' + (state.serverBackupError ? '<p class="form-note">' + esc(state.serverBackupError) + '</p>' : '') + serverRows + '</section></section>';
    }
    if (section === 'restore-preview') {
      const incoming = state.restorePreview;
      if (!incoming) return '<section class="screen active">' + heading('Configurações', 'Restauração', 'Nenhum arquivo de backup foi selecionado.') + '<button class="outline" data-route="settings:backup">Voltar ao backup</button></section>';
      return '<section class="screen active">' + heading('Configurações', 'Conferir backup antes de restaurar', 'Nada foi alterado ainda. Confira os números abaixo antes de substituir os dados atuais deste aparelho e da nuvem.') + '<section class="panel"><dl><dt>Ingredientes e insumos</dt><dd>' + incoming.supplies.length + '</dd><dt>Receitas</dt><dd>' + incoming.recipes.length + '</dd><dt>Produções</dt><dd>' + incoming.productions.length + '</dd><dt>Estoque produzido</dt><dd>' + incoming.readyStock.length + '</dd><dt>Pedidos</dt><dd>' + incoming.orders.length + '</dd><dt>Despesas</dt><dd>' + incoming.expenses.length + '</dd></dl><p class="form-note">Ao confirmar, os dados atuais serão substituídos. Baixe antes um backup dos dados atuais se quiser manter uma cópia.</p><div class="button-row"><button class="primary" data-action="confirm-restore">Restaurar este backup</button><button class="outline" data-action="cancel-restore">Cancelar</button></div></section></section>';
    }
    return '<section class="screen active">' + heading('Configurações', 'Configurações', 'Cada assunto fica em sua própria tela para evitar campos fora do lugar.') + '<div class="settings-list"><button data-route="settings:cloud"><b>Nuvem e sincronização</b><span>Pedidos, estoque e financeiro em todos os celulares</span></button><button data-route="settings:team"><b>Equipe e acessos</b><span>Pessoas, e-mails e funções da empresa</span></button><button data-route="settings:appearance"><b>Logo do app</b><span>Logo inicial e cabeçalho</span></button><button data-route="settings:message"><b>Mensagem e Pix</b><span>Confirmação de pedido e campos disponíveis</span></button><button data-route="settings:catalog"><b>Cardápio do cliente</b><span>Link e informações para quem vai comprar</span></button><button data-route="settings:delivery"><b>Frete e entrega</b><span>Locais, taxas e regras de frete grátis</span></button><button data-route="settings:backup"><b>Backup</b><span>Salvar e restaurar dados</span></button></div></section>';
  }
  function deliveryZones(value) {
    return String(value || '').split(/\r?\n/).map(line => {
      const [name, feeText = '', costText = ''] = line.split('|');
      return { id: String(name || '').trim().toLocaleLowerCase('pt-BR').replace(/[^a-z0-9]+/g, '-'), name: String(name || '').trim(), fee: Math.max(0, n(feeText)), cost: Math.max(0, n(costText)) };
    }).filter(zone => zone.name);
  }
  function catalogPayload() {
    return {
      brand: data.settings.catalogName || 'Gelatos Lele',
      intro: data.settings.catalogIntro || '',
      phone: data.settings.catalogPhone || '',
      address: data.settings.businessAddress || '',
      pickupAddress: data.settings.pickupAddress || '',
      deliveryModes: data.settings.deliveryModes || 'Retirada,Entrega',
      deliveryZones: deliveryZones(data.settings.deliveryZones),
      freeDeliveryMinValue: Math.max(0, n(data.settings.freeDeliveryMinValue)),
      freeDeliveryMinItems: Math.max(0, n(data.settings.freeDeliveryMinItems)),
      scheduledEnabled: data.settings.scheduledEnabled !== false,
      scheduledLeadDays: Math.max(2, Math.round(n(data.settings.scheduledLeadDays || 2))),
      scheduledMaxItemsPerDay: Math.max(0, n(data.settings.scheduledMaxItemsPerDay)),
      logo: data.settings.catalogLogoDataUrl || data.settings.headerLogoDataUrl || '',
      categories: productCategories().map(category => ({ id: category.id, name: category.name })),
      products: data.recipes.filter(recipe => recipe.active !== false).map(recipe => ({
        id: recipe.id,
        name: recipe.name,
        categoryId: categoryFor(recipe).id,
        categoryName: categoryFor(recipe).name,
        type: categoryFor(recipe).name,
        description: recipe.description || '',
        price: n(recipe.saleUnitPrice),
        available: n(ready()[recipe.id]?.quantity),
        image: recipe.imageData || ''
      }))
    };
  }
  function catalogLink() {
    try {
      if (cloudRevision !== null) return location.origin + location.pathname.replace(/[^/]*$/, '') + 'customer.html?v=40';
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
    set('financeFees', money(finance().paymentFee));
    set('financeDelivery', money(finance().deliveryCost));
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
      if (line.productId && n(line.quantity) > 0) grouped[line.productId] = qty((grouped[line.productId] || 0) + n(line.quantity));
    });
    return Object.entries(grouped).map(([productId, quantity]) => {
      const product = recipeById()[productId] || ready()[productId];
      const category = categoryFor(product);
      return { productId, quantity, saleUnitPrice: n(ready()[productId]?.saleUnitPrice || recipeById()[productId]?.saleUnitPrice), productCategoryId: category.id, productType: category.name };
    });
  }
  function estimateScheduledOrder(lines) {
    let revenue = 0, cost = 0;
    const resultLines = lines.map(line => {
      const recipe = recipeById()[line.productId];
      if (!recipe || recipe.active === false || !(n(line.quantity) > 0)) throw new Error('Um sabor da encomenda não está mais disponível no cardápio.');
      const quantity = qty(line.quantity);
      const saleUnitPrice = n(line.saleUnitPrice || recipe.saleUnitPrice);
      const unitCost = fullRecipeCost(recipe).unitCost;
      const result = { ...line, productName: recipe.name, quantity, saleUnitPrice, unitCost, total: round(quantity * saleUnitPrice), cost: round(quantity * unitCost), picked: false };
      revenue += result.total;
      cost += result.cost;
      return result;
    });
    return { lines: resultLines, revenue: round(revenue), cost: round(cost), profit: round(revenue - cost) };
  }
  function reserveOrder(lines, date, kind) {
    const result = window.GelatosCore.validateOrder(lines, ready());
    result.lines.forEach(line => {
      const product = ready()[line.productId];
      product.quantity = qty(n(product.quantity) - n(line.quantity));
      product.movements.push({ id: uid(), kind, quantity: -n(line.quantity), date });
    });
    return result;
  }
  function returnOrder(order, date, kind) {
    if (order.stockReserved === false) return;
    order.items.forEach(line => {
      const product = ready()[line.productId];
      if (!product) return;
      product.quantity = qty(n(product.quantity) + n(line.quantity));
      product.movements.push({ id: uid(), kind, quantity: n(line.quantity), date });
    });
    order.stockReserved = false;
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
        const paymentFee = paymentFeeFor(result.revenue, f.payment.value);
        data.orders.unshift({ id: uid(), customer, phone: f.phone.value.trim(), items: result.lines.map(line => ({ ...line, picked: false })), total: result.revenue, cost: result.cost, deliveryCost: 0, paymentFee, profit: round(result.profit - paymentFee), paymentMethod: f.payment.value, status: 'confirmed', orderKind: 'ready', stockReserved: true, date, dueDate: f.dueDate.value || date, paidAt: '' });
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
    if (old.orderKind === 'scheduled' && old.stockReserved === false) {
      try {
        const result = estimateScheduledOrder(lines);
        const freight = Math.max(0, n(old.freight));
        const total = round(result.revenue + freight);
        const paymentFee = paymentFeeFor(total, f.payment.value);
        const deliveryCost = Math.max(0, n(old.deliveryCost));
        Object.assign(old, { customer, phone: f.phone.value.trim(), items: result.lines, subtotal: result.revenue, total, cost: result.cost, deliveryCost, paymentFee, profit: round(total - result.cost - deliveryCost - paymentFee), paymentMethod: f.payment.value, date, dueDate: f.dueDate.value || date, scheduledFor: f.dueDate.value || old.scheduledFor || date });
        state.editOrder = '';
        state.orderLines = [{ productId: '', quantity: 1 }];
        state.orderDraft = null;
        save();
        toast('Encomenda atualizada. O estoque pronto continua sem baixa até a reserva.');
        navigate('orders:history');
      } catch (error) { toast(error.message); }
      return;
    }
    const snapshot = JSON.stringify(data.readyStock);
    try {
      if (old.status !== 'cancelled') returnOrder(old, date, 'Estorno para edição');
      const result = reserveOrder(lines, date, 'Pedido editado');
      const freight = Math.max(0, n(old.freight));
      const total = round(result.revenue + freight);
      const paymentFee = paymentFeeFor(total, f.payment.value);
      const deliveryCost = Math.max(0, n(old.deliveryCost));
      Object.assign(old, { customer, phone: f.phone.value.trim(), items: result.lines.map(line => ({ ...line, picked: false })), subtotal: result.revenue, total, cost: result.cost, deliveryCost, paymentFee, profit: round(total - result.cost - deliveryCost - paymentFee), paymentMethod: f.payment.value, date, dueDate: f.dueDate.value || date, status: old.status === 'cancelled' ? 'confirmed' : old.status, stockReserved: true });
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
    item.quantity = qty(oldQuantity + quantity);
    item.averageUnitCost = round((oldQuantity * n(item.averageUnitCost) + total) / (oldQuantity + quantity));
    item.lastPurchaseAt = date;
    item.lastPurchaseTotal = total;
    item.lastSupplierName = supplier?.name || '';
    const purchase = { id: uid(), supplyId: item.id, supplyName: item.name, supplierId: supplier?.id || '', supplierName: supplier?.name || '', quantity, unit: item.unit, total, unitPrice, date, paymentMethod: f.payment.value };
    item.movements.push({ id: uid(), purchaseId: purchase.id, kind: 'Compra', quantity, total, date, supplierId: supplier?.id || '', supplierName: supplier?.name || '', unitPrice, paymentMethod: f.payment.value });
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
    const difference = qty(quantity - n(item.quantity));
    const reason = String(f.adjustmentReason?.value || '').trim();
    if (difference && !reason) {
      toast('Informe o motivo da correção de quantidade para preservar o histórico.');
      return;
    }
    if (difference) item.movements.push({ id: uid(), kind: 'Ajuste manual', quantity: difference, total: 0, date: today(), reason, previousQuantity: n(item.quantity), resultingQuantity: quantity });
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
    const difference = qty(quantity - n(item.quantity));
    const reason = String(f.adjustmentReason?.value || '').trim();
    if (difference && !reason) {
      toast('Informe o motivo da correção de quantidade para preservar o histórico.');
      return;
    }
    if (difference) item.movements.push({ id: uid(), kind: 'Ajuste manual', quantity: difference, date: today(), reason, previousQuantity: n(item.quantity), resultingQuantity: quantity });
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
      const selectedCategory = productCategories().find(category => category.id === f.productCategoryId.value) || productCategories()[0];
      const recipe = {
        id: recipeId || uid(),
        name: control(form, 'name').value.trim(),
        productCategoryId: selectedCategory.id,
        productType: selectedCategory.name,
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
      // Preço e tipo novos valem para vendas futuras; o custo unitário do lote pronto continua histórico.
      data.readyStock.filter(item => String(item.recipeId) === String(recipe.id)).forEach(product => {
        product.name = recipe.name;
        product.productCategoryId = recipe.productCategoryId;
        product.productType = recipe.productType;
        product.saleUnitPrice = recipe.saleUnitPrice;
      });
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
    optimizeProductImage(image).then(write).catch(error => toast(error.message || 'Não foi possível ler a imagem. Tente outra foto.'));
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
    const category = categoryFor(recipe);
    if (product) {
      const oldQuantity = n(product.quantity);
      product.unitCost = round((oldQuantity * n(product.unitCost) + quantity * unitCost) / (oldQuantity + quantity));
      product.quantity = qty(oldQuantity + quantity);
      product.saleUnitPrice = n(recipe.saleUnitPrice);
      product.productCategoryId = category.id;
      product.productType = category.name;
      product.minimumStock = n(f.minimumStock.value) || n(product.minimumStock);
      product.movements.push({ id: uid(), kind: 'Cadastro manual', quantity, date });
    } else {
      product = { id: uid(), recipeId: recipe.id, name: recipe.name, productCategoryId: category.id, productType: category.name, quantity, unitCost, saleUnitPrice: n(recipe.saleUnitPrice), minimumStock: Math.max(0, n(f.minimumStock.value)), movements: [{ id: uid(), kind: 'Cadastro manual', quantity, date }] };
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
  function saveOpeningFinancial(form) {
    const f = form.elements;
    const current = openingFinancial();
    const received = round(current.receipts.reduce((sum, item) => sum + n(item.total), 0));
    const paid = round(current.payments.reduce((sum, item) => sum + n(item.total), 0));
    const receivableTotal = Math.max(0, n(f.receivable.value));
    const payableTotal = Math.max(0, n(f.payable.value));
    if (receivableTotal < received || payableTotal < paid) {
      toast('O total inicial não pode ficar menor que o valor já baixado. Confira os recebimentos e pagamentos anteriores.');
      return;
    }
    data.openingFinancial = normalizeOpeningFinancial({
      ...current,
      date: f.date.value || today(),
      balances: {
        Dinheiro: Math.max(0, n(f.cash.value)),
        Pix: Math.max(0, n(f.pix.value)),
        Crédito: Math.max(0, n(f.credit.value)),
        Débito: Math.max(0, n(f.debit.value))
      },
      receivableTotal,
      receivableRemaining: round(receivableTotal - received),
      payableTotal,
      payableRemaining: round(payableTotal - paid),
      note: String(f.note.value || '').trim()
    });
    save();
    toast('Fechamento inicial salvo. O saldo por forma de pagamento foi atualizado sem alterar o lucro.');
    navigate('finance:overview');
  }
  function saveOpeningSettlement(form) {
    const f = form.elements;
    const receiving = f.kind.value === 'receive';
    const opening = openingFinancial();
    const remaining = receiving ? n(opening.receivableRemaining) : n(opening.payableRemaining);
    const total = Math.max(0, n(f.total.value));
    if (!(total > 0) || total > remaining) {
      toast('Informe um valor maior que zero e igual ou menor que o saldo pendente.');
      return;
    }
    const record = { id: uid(), total, paymentMethod: METHODS.includes(f.payment.value) ? f.payment.value : 'Pix', date: f.date.value || today(), note: String(f.note.value || '').trim() };
    if (receiving) {
      opening.receipts.unshift(record);
      opening.receivableRemaining = round(remaining - total);
    } else {
      opening.payments.unshift(record);
      opening.payableRemaining = round(remaining - total);
    }
    data.openingFinancial = normalizeOpeningFinancial(opening);
    save();
    toast(receiving ? 'Recebimento antigo registrado no saldo.' : 'Pagamento antigo registrado no saldo.');
    navigate(receiving ? 'finance:receivable' : 'finance:payable');
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
  function categoryNameIsAvailable(name, exceptId = '') {
    const comparable = String(name || '').trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
    return comparable && !productCategories().some(item => String(item.id) !== String(exceptId) && String(item.name).trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR') === comparable);
  }
  function nextCategoryId(name) {
    const base = categorySlug(name) || 'categoria';
    let id = base;
    let suffix = 2;
    while (productCategories().some(item => item.id === id)) id = base + '-' + suffix++;
    return id;
  }
  function saveCategory(form, editing = false) {
    const name = String(control(form, 'name').value || '').trim();
    const id = editing ? String(control(form, 'id').value || '') : '';
    if (!name) { toast('Informe o nome da categoria.'); return; }
    if (!categoryNameIsAvailable(name, id)) { toast('Já existe uma categoria com este nome.'); return; }
    if (editing) {
      const category = productCategories().find(item => String(item.id) === id);
      if (!category) return;
      category.name = name;
      state.editProductCategory = '';
      toast('Categoria atualizada.');
    } else {
      data.productCategories.push({ id: nextCategoryId(name), name });
      toast('Categoria cadastrada.');
    }
    save();
    navigate('records:categories');
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
    const leadDays = Math.max(2, Math.min(30, Math.round(n(f.scheduledLeadDays.value || 2))));
    const maxItems = Math.max(0, qty(f.scheduledMaxItemsPerDay.value));
    const write = logo => {
      Object.assign(data.settings, {
        catalogName: f.catalogName.value.trim() || 'Gelatos Lele',
        catalogIntro: f.catalogIntro.value.trim(),
        catalogPhone: f.catalogPhone.value.trim(),
        businessAddress: f.businessAddress.value.trim(),
        scheduledEnabled: Boolean(f.scheduledEnabled.checked),
        scheduledLeadDays: String(leadDays),
        scheduledMaxItemsPerDay: maxItems > 0 ? String(maxItems) : '',
        catalogLogoDataUrl: logo || data.settings.catalogLogoDataUrl || ''
      });
      save();
      toast('Informações do cardápio atualizadas.');
      navigate('settings:catalog');
    };
    const logo = f.catalogLogo?.files?.[0];
    if (!logo) { write(''); return; }
    readFileDataUrl(logo).then(write).catch(error => toast(error.message || 'Não foi possível ler a logo.'));
  }
  function saveDeliverySettings(form) {
    const draft = deliveryDraftFromForm(form);
    const zones = draft.zones.filter(zone => zone.city);
    if (zones.some(zone => !String(zone.fee).trim())) {
      toast('Informe o valor do frete de cada cidade ou bairro cadastrado.');
      return;
    }
    if (String(draft.deliveryModes || '').toLocaleLowerCase('pt-BR').includes('entrega') && !zones.length) {
      toast('Cadastre pelo menos um local e sua taxa de frete para usar Entrega.');
      return;
    }
    const reservationMinutes = Math.round(n(draft.reservationMinutes));
    if (reservationMinutes < 5 || reservationMinutes > 120) {
      toast('Escolha uma reserva entre 5 e 120 minutos.');
      return;
    }
    Object.assign(data.settings, {
      deliveryModes: draft.deliveryModes.trim() || 'Retirada,Entrega',
      pickupAddress: draft.pickupAddress.trim(),
      deliveryZones: zones.map(zone => zone.city.trim() + ' | ' + n(zone.fee).toFixed(2).replace('.', ',') + ' | ' + n(zone.deliveryCost).toFixed(2).replace('.', ',')).join('\n'),
      freeDeliveryMinValue: draft.freeDeliveryMinValue.trim(),
      freeDeliveryMinItems: draft.freeDeliveryMinItems.trim(),
      creditFeePercent: draft.creditFeePercent.trim(),
      debitFeePercent: draft.debitFeePercent.trim(),
      reservationMinutes: String(reservationMinutes)
    });
    state.deliveryDraft = null;
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
  async function approveOrder(id) {
    if (!await confirmLatestStock()) return;
    const order = data.orders.find(item => String(item.id) === String(id));
    if (!order || order.status !== 'reserved') {
      toast('Esta reserva não está mais aguardando aprovação. Atualize a lista para conferir.');
      return;
    }
    if (order.reservationExpiresAt && new Date(order.reservationExpiresAt).getTime() <= Date.now()) {
      toast('Esta reserva venceu. Atualizando o estoque agora.');
      forceCloudRefresh();
      return;
    }
    order.status = 'confirmed';
    order.approvedAt = new Date().toISOString();
    order.reservationExpiresAt = '';
    addNotice('order', 'Pedido aprovado: ' + order.customer, 'Total de ' + money(order.total) + ' aguardando pagamento.', 'orders-history');
    save();
    toast('Pedido aprovado. Agora você pode separar e enviar a confirmação.');
    render();
  }
  function startScheduledProduction(id) {
    const order = data.orders.find(item => String(item.id) === String(id));
    if (!order || order.status !== 'scheduled') return;
    order.status = 'production';
    order.productionStartedAt = new Date().toISOString();
    addNotice('order', 'Encomenda em produção: ' + order.customer, 'Produza ' + order.items.reduce((sum, item) => sum + n(item.quantity), 0) + ' geladinho(s) para ' + brDate(order.scheduledFor || order.dueDate) + '.', 'production');
    save();
    toast('Encomenda marcada como em produção. O estoque pronto ainda não foi baixado.');
    render();
  }
  async function reserveScheduledOrder(id) {
    if (!await confirmLatestStock()) return;
    const order = data.orders.find(item => String(item.id) === String(id));
    if (!order || order.status !== 'production' || order.stockReserved) return;
    const snapshot = JSON.stringify(data.readyStock);
    try {
      const lines = order.items.map(item => ({ productId: item.productId, quantity: item.quantity, saleUnitPrice: item.saleUnitPrice }));
      const result = reserveOrder(lines, today(), 'Reserva para encomenda');
      const total = round(result.revenue + Math.max(0, n(order.freight)));
      const paymentFee = paymentFeeFor(total, order.paymentMethod);
      Object.assign(order, {
        items: result.lines.map((line, index) => ({ ...line, picked: Boolean(order.items[index]?.picked) })),
        subtotal: result.revenue,
        total,
        cost: result.cost,
        paymentFee,
        profit: round(total - result.cost - n(order.deliveryCost) - paymentFee),
        stockReserved: true,
        status: 'confirmed',
        stockReservedAt: new Date().toISOString()
      });
      addNotice('order', 'Encomenda pronta para separar: ' + order.customer, 'Estoque reservado para ' + brDate(order.scheduledFor || order.dueDate) + '.', 'orders-history');
      save();
      toast('Itens prontos reservados. Agora você pode separar, confirmar e receber o pagamento.');
      render();
    } catch (error) {
      data.readyStock = JSON.parse(snapshot);
      toast(error.message || 'Não foi possível reservar os itens produzidos.');
    }
  }
  function cancelOrder(id) {
    const order = data.orders.find(item => String(item.id) === String(id));
    const returnsStock = order?.stockReserved !== false;
    const question = order?.status === 'paid'
      ? 'Este pedido já foi marcado como pago. Confirme somente depois de devolver ou combinar o valor com o cliente. Cancelar' + (returnsStock ? ' devolverá os geladinhos ao estoque' : ' não movimentará estoque, pois a encomenda ainda não foi reservada') + ' e retirará a venda do faturamento.'
      : returnsStock ? 'Cancelar este pedido e devolver os geladinhos ao estoque?' : 'Cancelar esta encomenda? Nenhum geladinho será devolvido porque o estoque ainda não foi reservado.';
    if (!order || order.status === 'cancelled' || !confirm(question)) return;
    returnOrder(order, today(), 'Pedido cancelado');
    order.status = 'cancelled';
    order.cancelledAt = today();
    save();
    toast(returnsStock ? 'Pedido cancelado e estoque devolvido.' : 'Encomenda cancelada sem movimentar o estoque pronto.');
    render();
  }
  function deleteOrder(id) {
    const order = data.orders.find(item => String(item.id) === String(id));
    if (!order) return;
    if (order.status === 'paid') {
      toast('Pedidos pagos não podem ser arquivados como se nunca tivessem existido. Use Cancelar após tratar o reembolso.');
      return;
    }
    if (!confirm(order.status === 'cancelled' ? 'Arquivar este pedido cancelado? Ele continuará nos relatórios.' : 'Cancelar e arquivar este pedido? Os geladinhos voltarão ao estoque e o histórico será preservado.')) return;
    if (order.status !== 'cancelled') {
      returnOrder(order, today(), 'Pedido cancelado e arquivado');
      order.status = 'cancelled';
      order.cancelledAt = today();
    }
    order.archived = true;
    save();
    toast('Pedido arquivado. O histórico continua nos relatórios.');
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
    const hasHistory = item.movements.length || data.purchases.some(entry => String(entry.supplyId) === String(id)) || data.expenses.some(entry => String(entry.supplyId) === String(id));
    if (hasHistory) {
      if (n(item.quantity) !== 0) {
        toast('Para arquivar este item com histórico, primeiro corrija a quantidade para zero e informe o motivo.');
        return;
      }
      item.active = false;
      item.archivedAt = today();
      save();
      toast('Item arquivado. Compras e financeiro foram preservados.');
      navigate('stock:' + (item.category === 'supply' ? 'supply' : 'ingredient'));
      return;
    }
    data.supplies = data.supplies.filter(entry => String(entry.id) !== String(id));
    save();
    toast('Cadastro excluído.');
    navigate('stock:ingredient');
  }
  function restoreSupply(id) {
    const item = supplies()[id];
    if (!item || item.active !== false) return;
    item.active = true;
    item.archivedAt = '';
    save();
    toast('Item reativado no estoque.');
    navigate('stock:' + (item.category === 'supply' ? 'supply' : 'ingredient'));
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
    if (!expense || expense.category === 'purchase' || !confirm('Anular esta conta paga? Ela sairá do resultado, mas ficará registrada no histórico.')) return;
    expense.voided = true;
    expense.voidedAt = today();
    state.editExpense = '';
    save();
    toast('Conta anulada. O histórico financeiro foi preservado.');
    navigate('finance:payable');
  }
  function restoreExpense(id) {
    const expense = data.expenses.find(item => String(item.id) === String(id));
    if (!expense || !expense.voided) return;
    expense.voided = false;
    expense.voidedAt = '';
    save();
    toast('Conta restaurada no financeiro.');
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
  function deleteCategory(id) {
    const category = productCategories().find(item => String(item.id) === String(id));
    if (!category || !confirm('Excluir a categoria "' + category.name + '"?')) return;
    const linked = data.recipes.filter(recipe => categoryFor(recipe).id === category.id);
    if (linked.length) {
      toast('Não é possível excluir: ' + linked.length + (linked.length === 1 ? ' receita usa esta categoria.' : ' receitas usam esta categoria.'));
      return;
    }
    if (productCategories().length <= 1) {
      toast('Mantenha pelo menos uma categoria cadastrada.');
      return;
    }
    data.productCategories = productCategories().filter(item => item.id !== category.id);
    state.editProductCategory = '';
    save();
    toast('Categoria excluída.');
    navigate('records:categories');
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
      .replace(/\{pix\}/g, data.settings.pixKey || 'A combinar')
      .replace(/\{data_entrega\}/g, brDate(order.scheduledFor || order.dueDate || order.date));
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
        state.restorePreview = normalize(imported);
        state.screen = 'settings-restore-preview';
        toast('Confira o conteúdo do backup antes de restaurar.');
        render();
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
        cloudBaseData = cloneData(data);
        cloudDirty = false;
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
      cloudBaseData = cloneData(data);
      cloudDirty = false;
      saveLocal();
      toast('Empresa ativada e dados enviados para a nuvem.');
      navigate('home');
    } catch (error) { toast(error.message || 'Não foi possível ativar a empresa.'); }
  }
  async function forceCloudRefresh() {
    try {
      const remote = await window.GelatosCloud.getState();
      if (cloudDirty) {
        data = reconcileCloudState(remote.state).merged;
        cloudRevision = Number(remote.revision);
        saveLocal();
        render();
        queueCloudSave();
        toast('Alterações locais e da nuvem foram conciliadas.');
        return;
      }
      data = normalize(remote.state);
      cloudRevision = Number(remote.revision);
      cloudBaseData = cloneData(data);
      saveLocal();
      render();
      toast('Dados atualizados pela nuvem.');
    } catch (error) { toast(error.message || 'Não foi possível atualizar agora.'); }
  }
  async function loadTeamMembers() {
    if (!window.GelatosCloud?.hasSession()) {
      state.teamMembers = [];
      state.teamError = 'Entre na nuvem antes de gerenciar a equipe.';
      if (state.screen === 'settings-team') render();
      return;
    }
    state.teamError = '';
    try {
      const result = await window.GelatosCloud.listMembers();
      state.teamMembers = Array.isArray(result?.members) ? result.members : [];
    } catch (error) {
      state.teamError = error.message || 'Não foi possível carregar os acessos.';
    }
    if (state.screen === 'settings-team') render();
  }
  async function saveTeamMember(form) {
    const email = String(form.elements.email.value || '').trim();
    const role = String(form.elements.role.value || 'manager');
    if (!email) { toast('Informe o e-mail da pessoa.'); return; }
    try {
      await window.GelatosCloud.addMember(email, role);
      toast('Acesso liberado para ' + email + '.');
      await loadTeamMembers();
    } catch (error) { toast(error.message || 'Não foi possível liberar este acesso.'); }
  }
  async function removeTeamMember(userId) {
    if (!confirm('Remover o acesso desta pessoa? Ela deixará de entrar nos dados da empresa.')) return;
    try {
      await window.GelatosCloud.removeMember(userId);
      toast('Acesso removido.');
      await loadTeamMembers();
    } catch (error) { toast(error.message || 'Não foi possível remover este acesso.'); }
  }
  async function loadServerBackups() {
    if (!window.GelatosCloud?.hasSession()) return;
    state.serverBackupError = '';
    try {
      const result = await window.GelatosCloud.listBackups();
      state.serverBackups = Array.isArray(result?.backups) ? result.backups : [];
    } catch (error) {
      state.serverBackups = [];
      state.serverBackupError = error.message || 'Não foi possível carregar o histórico da nuvem.';
    }
    if (state.screen === 'settings-backup') render();
  }
  async function restoreServerBackup(snapshotDate) {
    if (!confirm('Restaurar a cópia de ' + brDate(snapshotDate) + '? O estado atual também será guardado antes da restauração.')) return;
    try {
      const result = await window.GelatosCloud.restoreBackup(snapshotDate);
      data = normalize(result.state);
      cloudRevision = Number(result.revision);
      cloudBaseData = cloneData(data);
      cloudDirty = false;
      saveLocal();
      toast('Versão restaurada da nuvem. Confira os dados antes de continuar.');
      navigate('home');
    } catch (error) { toast(error.message || 'Não foi possível restaurar esta versão.'); }
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
      ? [brDate(row.date), row.name, row.items, row.location, row.payment, row.status, row.value]
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
    if (action === 'add-delivery-zone') {
      state.deliveryDraft = deliveryDraftFromForm($('#deliverySettingsForm'));
      state.deliveryDraft.zones.push({ city: '', fee: '', deliveryCost: '' });
      const index = state.deliveryDraft.zones.length - 1;
      render({ preserveScroll: true, focusSelector: '[data-zone-city="' + index + '"]' });
      return;
    }
    if (action === 'remove-delivery-zone') {
      state.deliveryDraft = deliveryDraftFromForm($('#deliverySettingsForm'));
      state.deliveryDraft.zones.splice(n(actionNode.dataset.index), 1);
      render({ preserveScroll: true });
      return;
    }
    if (action === 'add-order-line') { rememberOrderDraft(); state.orderLines.push({ productId: '', quantity: 1 }); render(); return; }
    if (action === 'remove-order-line') { state.orderLines.splice(n(actionNode.dataset.index), 1); if (!state.orderLines.length) state.orderLines.push({ productId: '', quantity: 1 }); render(); return; }
    if (action === 'edit-order') {
      const order = data.orders.find(item => String(item.id) === String(id));
      if (order) { state.editOrder = id; state.orderLines = order.items.map(line => ({ productId: line.productId, quantity: line.quantity })); state.orderDraft = { customer: order.customer, phone: order.phone || '', payment: order.paymentMethod, date: order.date, dueDate: order.dueDate }; state.screen = 'order-edit'; render(); }
      return;
    }
    if (action === 'approve-order') { approveOrder(id); return; }
    if (action === 'start-scheduled-production') { startScheduledProduction(id); return; }
    if (action === 'reserve-scheduled-order') { reserveScheduledOrder(id); return; }
    if (action === 'mark-paid') { markPaid(id); return; }
    if (action === 'cancel-order') { cancelOrder(id); return; }
    if (action === 'delete-order') { deleteOrder(id); return; }
    if (action === 'send-order') { sendOrder(id); return; }
    if (action === 'edit-supply') { state.editSupply = id; state.screen = 'supply-edit'; render(); return; }
    if (action === 'delete-supply') { deleteSupply(id); return; }
    if (action === 'restore-supply') { restoreSupply(id); return; }
    if (action === 'inspect-price') { state.compareSupply = id; state.comparePrice = ''; state.compareQuantity = ''; navigate('tools:compare'); return; }
    if (action === 'edit-ready') { state.editReady = id; state.screen = 'ready-edit'; render(); return; }
    if (action === 'delete-ready') { deleteReady(id); return; }
    if (action === 'new-ready') { state.screen = 'stock-ready-manual'; render(); return; }
    if (action === 'add-recipe-line') { state.recipeDraft = recipeDraftFromScreen(); state.recipeLines.push({ supplyId: '', quantity: '', unit: '' }); render({ preserveScroll: true, focusSelector: '[data-recipe-supply="' + (state.recipeLines.length - 1) + '"]' }); return; }
    if (action === 'remove-recipe-line') { state.recipeLines.splice(n(actionNode.dataset.index), 1); if (!state.recipeLines.length) state.recipeLines.push({ supplyId: '', quantity: '', unit: '' }); state.recipeDraft = recipeDraftFromScreen(); render({ preserveScroll: true }); return; }
    if (action === 'new-recipe') { state.editRecipe = ''; state.recipeLinesLoaded = false; state.recipeLines = [{ supplyId: '', quantity: '', unit: '' }]; state.recipeDraft = null; navigate('recipes'); return; }
    if (action === 'new-recipe-category') {
      const category = productCategories().find(item => String(item.id) === String(id));
      if (!category) { toast('Categoria não encontrada. Atualize a tela e tente novamente.'); return; }
      state.editRecipe = '';
      state.recipeLinesLoaded = false;
      state.recipeLines = [{ supplyId: '', quantity: '', unit: '' }];
      state.recipeDraft = { name: '', productCategoryId: category.id, yieldUnits: '', saleUnitPrice: '', laborAmount: '', laborMode: 'batch', preparation: '', description: '', active: true };
      navigate('recipes');
      return;
    }
    if (action === 'view-recipe') { state.viewRecipe = id; state.screen = 'recipe-view'; render(); return; }
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
    if (action === 'restore-expense') { restoreExpense(id); return; }
    if (action === 'edit-supplier') { state.editSupplier = id; state.screen = 'supplier-edit'; render(); return; }
    if (action === 'delete-supplier') { deleteSupplier(id); return; }
    if (action === 'edit-category') { state.editProductCategory = id; state.screen = 'category-edit'; render(); return; }
    if (action === 'delete-category') { deleteCategory(id); return; }
    if (action === 'clear-filter') { state.reportFilter = { start: '', end: '', min: '', max: '', query: '', payment: '', status: '', location: '' }; render(); return; }
    if (action === 'export-xlsx') { exportXlsx(); return; }
    if (action === 'copy-catalog-link') { copyCatalogLink(); return; }
    if (action === 'cloud-refresh') { forceCloudRefresh(); return; }
    if (action === 'cloud-signout') { clearTimeout(cloudSyncTimer); cloudRevision = null; window.GelatosCloud.signOut(); toast('Este celular saiu da nuvem. Os dados locais foram mantidos.'); navigate('settings:cloud'); return; }
    if (action === 'remove-member') { removeTeamMember(id); return; }
    if (action === 'backup') { backup(); return; }
    if (action === 'restore') { $('#restoreFile')?.click(); return; }
    if (action === 'restore-server-backup') { restoreServerBackup(id); return; }
    if (action === 'confirm-restore') {
      if (!state.restorePreview) return;
      data = normalize(state.restorePreview);
      state.restorePreview = null;
      save();
      toast('Backup restaurado. Os dados serão sincronizados com a nuvem quando houver internet.');
      navigate('home');
      return;
    }
    if (action === 'cancel-restore') { state.restorePreview = null; navigate('settings:backup'); return; }
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
    else if (formId === 'teamMemberForm') saveTeamMember(form);
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
    else if (formId === 'openingFinancialForm') saveOpeningFinancial(form);
    else if (formId === 'openingSettlementForm') saveOpeningSettlement(form);
    else if (formId === 'supplierForm') saveSupplier(form, false);
    else if (formId === 'supplierEditForm') saveSupplier(form, true);
    else if (formId === 'categoryForm') saveCategory(form, false);
    else if (formId === 'categoryEditForm') saveCategory(form, true);
    else if (formId === 'compareForm') { state.compareSupply = form.elements.supplyId.value; state.comparePrice = form.elements.unitPrice.value; state.compareQuantity = form.elements.quantity.value; render(); }
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
  if ('serviceWorker' in navigator) window.addEventListener('load', () => {
    const updateButton = $('#appUpdate');
    const showUpdate = () => { if (updateButton) updateButton.hidden = false; };
    updateButton?.addEventListener('click', () => location.reload());
    navigator.serviceWorker.register('./service-worker.js?v=40').then(registration => {
      // Solicita a checagem mesmo em quem abre o atalho instalado há semanas.
      registration.update().catch(() => {});
      if (registration.waiting) showUpdate();
      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        worker?.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) showUpdate();
        });
      });
      navigator.serviceWorker.addEventListener('controllerchange', showUpdate);
    }).catch(() => {});
  });
})();
