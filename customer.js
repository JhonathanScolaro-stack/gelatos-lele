(() => {
  'use strict';

  const root = document.getElementById('customerApp');
  const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
  const num = value => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    let text = String(value ?? '').trim().replace(/\s/g, '');
    if (text.includes(',') && text.includes('.')) text = text.replace(/\./g, '').replace(',', '.'); else text = text.replace(',', '.');
    const number = Number(text.replace(/[^0-9.-]/g, ''));
    return Number.isFinite(number) ? number : 0;
  };
  const availability = product => Math.max(0, Math.floor(num(product?.available)));
  const productType = value => {
    const type = String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleLowerCase('pt-BR');
    if (type === 'agua') return 'Água';
    if (type === 'leite') return 'Leite';
    return 'Gourmet';
  };
  const categorySlug = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const DEFAULT_CATEGORIES = [
    { id: 'agua', name: 'Geladinho de água' },
    { id: 'leite', name: 'Geladinho de leite' },
    { id: 'gourmet', name: 'Geladinho gourmet' }
  ];
  const legacyCategoryId = value => {
    const type = productType(value);
    return type === 'Água' ? 'agua' : type === 'Leite' ? 'leite' : 'gourmet';
  };
  const managementUrl = () => location.origin + location.pathname.replace(/[^/]*$/, '') + 'index.html?v=42';
  const ORDER_ATTEMPT_KEY = 'gelatos-lele-customer-order-attempt-v1';
  const CUSTOMER_CLIENT_KEY = 'gelatos-lele-customer-client-v1';
  const newAttemptId = () => (window.crypto?.randomUUID?.() || (Date.now().toString(36) + '-' + Math.random().toString(36).slice(2)));
  const customerClientId = () => {
    let value = localStorage.getItem(CUSTOMER_CLIENT_KEY);
    if (!value) {
      value = newAttemptId() + '-' + newAttemptId();
      localStorage.setItem(CUSTOMER_CLIENT_KEY, value);
    }
    return value;
  };
  const managementBack = () => window.GelatosCloud?.hasSession?.()
    ? '<button type="button" class="back-app" data-action="back-customer">← Gestão</button>'
    : '';

  let catalog = null;
  let quantities = {};
  let selectedProductId = '';
  let openCategoryId = '';
  let reviewing = false;
  let draft = { customer: '', phone: '', mode: 'Retirada', zoneId: '', address: '', payment: 'Pix', orderKind: 'ready', scheduledFor: '' };
  let orderAttemptId = '';

  function legacyCatalog() {
    try {
      const fragment = location.hash.replace(/^#c=/, '');
      if (!fragment) return null;
      const parsed = JSON.parse(decodeURIComponent(escape(atob(fragment))));
      return Array.isArray(parsed?.products) ? parsed : null;
    } catch (_) { return null; }
  }
  function start(nextCatalog, preserveDraft = false) {
    const previousQuantities = quantities;
    catalog = nextCatalog;
    quantities = Object.fromEntries(catalog.products.map(product => [product.id, preserveDraft ? num(previousQuantities[product.id]) : 0]));
    const modes = availableModes();
    if (!preserveDraft) {
      draft = { customer: '', phone: '', mode: modes[0] || 'Retirada', zoneId: deliveryZones()[0]?.id || '', address: '', payment: 'Pix', orderKind: 'ready', scheduledFor: scheduledMinDate() };
      orderAttemptId = '';
      sessionStorage.removeItem(ORDER_ATTEMPT_KEY);
    }
    selectedProductId = '';
    openCategoryId = '';
    reviewing = false;
    render();
  }
  function availableModes() { return String(catalog?.deliveryModes || 'Retirada,Entrega').split(',').map(mode => mode.trim()).filter(Boolean); }
  function scheduledEnabled() { return catalog?.scheduledEnabled !== false; }
  function scheduledLeadDays() { return Math.max(2, Math.min(30, Math.floor(num(catalog?.scheduledLeadDays || 2)))); }
  function localDate(value = new Date()) {
    const date = value instanceof Date ? value : new Date(value + 'T12:00:00');
    return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
  }
  function scheduledMinDate() {
    const date = new Date();
    date.setHours(12, 0, 0, 0);
    date.setDate(date.getDate() + scheduledLeadDays());
    return localDate(date);
  }
  function isScheduled() { return draft.orderKind === 'scheduled'; }
  function scheduledDateText(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return '—';
    return new Date(value + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });
  }
  function deliveryZones() { return (Array.isArray(catalog?.deliveryZones) ? catalog.deliveryZones : []).map((zone, index) => ({ id: String(zone.id || index), name: String(zone.name || '').trim(), fee: Math.max(0, num(zone.fee)) })).filter(zone => zone.name); }
  function selectedProducts() { return catalog.products.filter(product => quantities[product.id] > 0); }
  function catalogCategories() {
    const entries = Array.isArray(catalog?.categories) ? catalog.categories : [];
    const used = new Set();
    const normalized = entries.map((category, index) => {
      const name = String(category?.name || '').trim();
      let id = categorySlug(category?.id || name) || 'categoria-' + (index + 1);
      if (!name || used.has(id)) return null;
      used.add(id);
      return { id, name };
    }).filter(Boolean);
    return normalized.length ? normalized : DEFAULT_CATEGORIES.map(category => ({ ...category }));
  }
  function categoryForProduct(product) {
    const categories = catalogCategories();
    const id = String(product?.categoryId || product?.productCategoryId || '');
    const direct = categories.find(category => category.id === id);
    if (direct) return direct;
    const legacy = categories.find(category => category.id === legacyCategoryId(product?.type || product?.productType));
    return legacy || categories[0];
  }
  function catalogGroups() {
    return catalogCategories().map(category => ({
      category,
      products: catalog.products.filter(product => categoryForProduct(product).id === category.id).sort((a, b) => String(a.name).localeCompare(String(b.name), 'pt-BR'))
    })).filter(group => group.products.length);
  }
  function applyConfirmedStock(saved) {
    // A resposta do servidor é a fonte da verdade. Em encomendas, somente a
    // parte que já estava pronta é retirada agora; o restante fica pendente de
    // produção e não pode reduzir o estoque duas vezes.
    const reservedByProduct = Object.fromEntries((saved?.items || []).map(item => [String(item.productId), num(item.reservedQuantity ?? (saved?.orderKind === 'scheduled' ? 0 : item.quantity))]));
    selectedProducts().forEach(product => {
      const reserved = Object.prototype.hasOwnProperty.call(reservedByProduct, String(product.id))
        ? reservedByProduct[String(product.id)]
        : (isScheduled() ? 0 : num(quantities[product.id]));
      product.available = Math.max(0, num(product.available) - reserved);
    });
  }
  function isDelivery() { return String(draft.mode || '').toLocaleLowerCase('pt-BR').includes('entrega'); }
  function syncDraft(form) {
    if (!form) return;
    const f = form.elements;
    if (f.customer) draft.customer = f.customer.value;
    if (f.phone) draft.phone = f.phone.value;
    if (f.mode) draft.mode = f.mode.value;
    if (f.zoneId) draft.zoneId = f.zoneId.value;
    if (f.address) draft.address = f.address.value;
    if (f.payment) draft.payment = f.payment.value;
    if (f.scheduledFor) draft.scheduledFor = f.scheduledFor.value;
  }
  function orderTotals() {
    const selected = selectedProducts();
    const quantity = selected.reduce((sum, product) => sum + quantities[product.id], 0);
    const subtotal = selected.reduce((sum, product) => sum + num(product.price) * quantities[product.id], 0);
    const zone = deliveryZones().find(item => String(item.id) === String(draft.zoneId));
    const freeByValue = num(catalog.freeDeliveryMinValue) > 0 && subtotal >= num(catalog.freeDeliveryMinValue);
    const freeByQuantity = num(catalog.freeDeliveryMinItems) > 0 && quantity >= num(catalog.freeDeliveryMinItems);
    const delivery = isDelivery();
    const free = delivery && (freeByValue || freeByQuantity);
    const fee = delivery && zone && !free && quantity > 0 ? zone.fee : 0;
    return { selected, quantity, subtotal, zone, delivery, free, fee, freeReason: freeByValue ? 'Frete grátis por valor mínimo' : freeByQuantity ? 'Frete grátis por quantidade mínima' : '', total: subtotal + fee };
  }
  function validateOrderDraft(result) {
    if (draft.customer.trim().length < 2) return 'Informe seu nome.';
    if (draft.phone.replace(/\D/g, '').length < 10) return 'Informe um WhatsApp válido para confirmar o pedido.';
    if (!result.selected.length) return 'Escolha pelo menos um geladinho.';
    if (isScheduled() && (!/^\d{4}-\d{2}-\d{2}$/.test(draft.scheduledFor) || draft.scheduledFor < scheduledMinDate())) return 'Escolha uma data a partir de ' + scheduledDateText(scheduledMinDate()) + '.';
    if (result.delivery && !result.zone) return 'Escolha o local de entrega.';
    if (result.delivery && draft.address.trim().length < 5) return 'Informe o endereço de entrega completo.';
    return '';
  }
  function cartLines(result) {
    return result.selected.length
      ? '<ul class="cart-lines">' + result.selected.map(product => '<li><span>' + quantities[product.id] + ' × ' + esc(product.name) + '</span><b>' + money.format(num(product.price) * quantities[product.id]) + '</b></li>').join('') + '</ul>'
      : '<p class="cart-empty">Nenhum geladinho selecionado ainda.</p>';
  }
  function productCard(product) {
    const available = availability(product);
    const chosen = quantities[product.id] || 0;
    const opened = String(selectedProductId) === String(product.id);
    const scheduled = isScheduled();
    const soldOut = !scheduled && available === 0;
    const maximum = scheduled ? 99 : available;
    const category = categoryForProduct(product);
    return '<article class="product ' + (soldOut ? 'sold-out' : '') + '"><button class="product-open" type="button" data-action="choose-product" data-product="' + esc(product.id) + '" aria-expanded="' + opened + '">' +
      (product.image ? '<img src="' + esc(product.image) + '" alt="' + esc(product.name) + '">' : '<div class="image-placeholder" aria-hidden="true"></div>') +
      '<span class="product-copy"><span class="product-title"><b>' + esc(product.name) + '</b>' + (chosen ? '<em>' + chosen + ' no pedido</em>' : '') + '</span><span class="product-type category-' + esc(categorySlug(category.id)) + '">' + esc(category.name) + '</span><span class="product-description">' + esc(product.description || 'Geladinho artesanal.') + '</span><span class="price">' + money.format(num(product.price)) + '</span><span class="availability ' + (soldOut ? 'unavailable' : '') + '">' + (scheduled ? 'Disponível por encomenda' : soldOut ? 'Esgotado no momento' : available + ' disponível(is)') + '</span></span><span class="product-arrow" aria-hidden="true">›</span></button>' +
      (opened ? '<section class="product-picker"><b>' + (soldOut ? 'Este sabor está esgotado.' : 'Quantos você quer?') + '</b>' + (soldOut ? '<span>Acompanhe o cardápio; ele volta a ficar disponível assim que houver produção.</span>' : '<div class="quantity"><button type="button" data-change="' + esc(product.id) + ':-1" aria-label="Diminuir ' + esc(product.name) + '"' + (chosen ? '' : ' disabled') + '>−</button><strong>' + chosen + '</strong><button type="button" data-change="' + esc(product.id) + ':1" aria-label="Aumentar ' + esc(product.name) + '"' + (chosen >= maximum ? ' disabled' : '') + '>+</button><small>' + (scheduled ? 'A Gelatos Lele confirmará a disponibilidade para a data escolhida.' : 'Máximo disponível: ' + available) + '</small></div>') + '</section>' : '') +
      '</article>';
  }
  function categoryCard(group) {
    const opened = String(openCategoryId) === String(group.category.id);
    const count = group.products.length;
    return '<section class="catalog-type ' + (opened ? 'is-open' : '') + '"><button type="button" class="catalog-type-heading catalog-category-toggle" data-action="toggle-category" data-category="' + esc(group.category.id) + '" aria-expanded="' + opened + '"><span><b>' + esc(group.category.name) + '</b><small>' + count + (count === 1 ? ' sabor disponível no cardápio' : ' sabores disponíveis no cardápio') + '</small></span><span class="catalog-category-action">' + (opened ? 'Fechar' : 'Ver sabores') + ' <i aria-hidden="true">⌄</i></span></button><div class="product-list"' + (opened ? '' : ' hidden') + '>' + group.products.map(productCard).join('') + '</div></section>';
  }
  function fulfillmentChooser() {
    const ready = !isScheduled();
    const scheduled = isScheduled();
    return '<section class="fulfillment-picker" aria-label="Tipo de pedido"><p>Como você quer pedir?</p><div><button type="button" class="' + (ready ? 'selected' : '') + '" data-action="choose-order-kind" data-kind="ready"><b>Pronta entrega</b><span>Escolha somente os sabores que já estão produzidos.</span></button>' + (scheduledEnabled() ? '<button type="button" class="' + (scheduled ? 'selected' : '') + '" data-action="choose-order-kind" data-kind="scheduled"><b>Encomendar</b><span>Peça sabores para uma data futura.</span></button>' : '') + '</div>' + (scheduled ? '<label class="schedule-date">Data desejada<input name="scheduledFor" form="customerOrder" type="date" min="' + scheduledMinDate() + '" value="' + esc(draft.scheduledFor || scheduledMinDate()) + '" required><small>Encomendas precisam de pelo menos ' + scheduledLeadDays() + ' dias para preparo.</small></label>' : '') + '</section>';
  }
  function totalsMarkup(result) {
    const freightText = !result.quantity ? 'Selecione os sabores' : !result.delivery ? 'R$ 0,00 (retirada)' : result.free ? 'Grátis' : result.zone ? money.format(result.fee) : 'A combinar';
    return '<div class="total total-breakdown"><span>Subtotal dos geladinhos</span><b>' + money.format(result.subtotal) + '</b><span>Frete' + (result.freeReason ? ' · ' + esc(result.freeReason) : '') + '</span><b>' + freightText + '</b><strong>Valor total</strong><strong>' + money.format(result.total) + '</strong></div>';
  }
  function orderForm(result, zones, modes) {
    const zoneField = result.delivery ? '<label>Local de entrega<select name="zoneId" required><option value="">Selecione o local</option>' + zones.map(zone => '<option value="' + esc(zone.id) + '"' + (String(zone.id) === String(draft.zoneId) ? ' selected' : '') + '>' + esc(zone.name) + ' · frete ' + money.format(zone.fee) + '</option>').join('') + '</select></label>' : '';
    const pickupNotice = !result.delivery && String(catalog.pickupAddress || '').trim() ? '<section class="notice"><b>Endereço para retirada:</b><br>' + esc(catalog.pickupAddress).replace(/\n/g, '<br>') + '</section>' : '';
    const addressLabel = result.delivery ? 'Endereço de entrega' : 'Observação para retirada (opcional)';
    const addressPlaceholder = result.delivery ? 'Rua, número, bairro e ponto de referência.' : 'Ex.: horário desejado para retirar.';
    const scheduleNotice = isScheduled() ? '<section class="notice scheduled-notice"><b>Encomenda para ' + esc(scheduledDateText(draft.scheduledFor)) + '.</b><br>Depois do envio, a Gelatos Lele confirmará o preparo e o pagamento pelo WhatsApp.</section>' : '';
    return pickupNotice + '<form id="customerOrder" class="panel checkout"><h2>Seu pedido</h2>' + scheduleNotice + cartLines(result) + '<label>Seu nome<input name="customer" required value="' + esc(draft.customer) + '" placeholder="Ex.: Maria"></label><label>WhatsApp para confirmação<input name="phone" inputmode="tel" required value="' + esc(draft.phone) + '" placeholder="Ex.: 11999999999"></label><p class="small">Usaremos somente para confirmar este pedido.</p><label>Forma de receber<select name="mode">' + modes.map(mode => '<option' + (mode === draft.mode ? ' selected' : '') + '>' + esc(mode) + '</option>').join('') + '</select></label>' + zoneField + '<label>' + addressLabel + '<textarea name="address" placeholder="' + addressPlaceholder + '">' + esc(draft.address) + '</textarea></label><label>Forma de pagamento<select name="payment"><option' + (draft.payment === 'Pix' ? ' selected' : '') + '>Pix</option><option' + (draft.payment === 'Dinheiro' ? ' selected' : '') + '>Dinheiro</option><option' + (draft.payment === 'Crédito' ? ' selected' : '') + '>Crédito</option><option' + (draft.payment === 'Débito' ? ' selected' : '') + '>Débito</option></select></label>' + totalsMarkup(result) + '<button class="primary">Revisar pedido</button><p class="small">Antes de enviar, você verá itens, frete, endereço e valor total.</p></form>';
  }
  function reviewForm(result) {
    const deliveryText = result.delivery ? (result.zone?.name || 'Local não informado') : 'Retirada';
    const addressText = result.delivery ? draft.address : (catalog.pickupAddress || draft.address || 'A combinar');
    const orderDescription = isScheduled() ? 'Ao enviar, o que já estiver pronto será separado para você; somente os sabores restantes entram na programação de produção. A confirmação será enviada pelo WhatsApp.' : 'Ao enviar, o estoque será reservado por um tempo limitado até a Gelatos Lele aprovar o pedido.';
    const scheduling = isScheduled() ? '<dt>Encomenda para</dt><dd>' + esc(scheduledDateText(draft.scheduledFor)) + '</dd>' : '';
    return '<form id="customerOrder" class="panel checkout checkout-review"><h2>Confira seu pedido</h2><p class="small">' + orderDescription + '</p>' + cartLines(result) + '<dl class="review-details"><dt>Cliente</dt><dd>' + esc(draft.customer) + '</dd><dt>WhatsApp</dt><dd>' + esc(draft.phone) + '</dd>' + scheduling + '<dt>Recebimento</dt><dd>' + esc(draft.mode) + '</dd><dt>Local</dt><dd>' + esc(deliveryText) + '</dd><dt>Endereço</dt><dd>' + esc(addressText).replace(/\n/g, '<br>') + '</dd><dt>Pagamento</dt><dd>' + esc(draft.payment) + '</dd></dl>' + totalsMarkup(result) + '<div class="checkout-actions"><button type="button" class="outline" data-action="edit-checkout">Editar pedido</button><button class="primary">Enviar pedido</button></div></form>';
  }
  function render() {
    const result = orderTotals();
    const zones = deliveryZones();
    const modes = availableModes();
    const groups = catalogGroups();
    const products = groups.length ? groups.map(categoryCard).join('') : '<p class="empty">Nenhum sabor foi cadastrado no cardápio ainda.</p>';
    const logo = String(catalog.logo || 'logo-transparente-v2.png').trim();
    root.innerHTML = '<section class="hero">' + managementBack() + '<img class="catalog-logo" src="' + esc(logo) + '" alt="' + esc(catalog.brand || 'Gelatos Lele') + '"><h1 class="catalog-brand-name">' + esc(catalog.brand || 'Gelatos Lele') + '</h1><p>' + esc(catalog.intro || 'Confira os sabores disponíveis.') + '</p></section>' +
      (catalog.address ? '<section class="notice"><b>Informações:</b><br>' + esc(catalog.address).replace(/\n/g, '<br>') + '</section>' : '') +
      fulfillmentChooser() + '<section class="products"><div class="catalog-heading"><h2>' + (isScheduled() ? 'Cardápio para encomenda' : 'Cardápio pronta entrega') + '</h2><span>' + (isScheduled() ? 'Escolha sabores para a data desejada. A produção será confirmada pela Gelatos Lele.' : 'Escolha por tipo e toque em um sabor para informar a quantidade.') + '</span></div>' + products + '</section>' +
      (reviewing ? reviewForm(result) : orderForm(result, zones, modes));
  }
  function confirmation(result) {
    const freight = num(result.freight) > 0 ? '<p>Frete: ' + money.format(num(result.freight)) + '</p>' : '';
    const scheduled = result.orderKind === 'scheduled';
    const reservation = result.reservationExpiresAt ? '<p>Sua reserva fica ativa até ' + esc(new Date(result.reservationExpiresAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })) + '.</p>' : '';
    const schedule = scheduled ? '<p><b>Encomenda para ' + esc(scheduledDateText(result.scheduledFor)) + '.</b></p>' : '';
    const reserved = (result.items || []).reduce((sum, item) => sum + num(item.reservedQuantity ?? (scheduled ? 0 : item.quantity)), 0);
    const pending = (result.items || []).reduce((sum, item) => sum + num(item.pendingProductionQuantity ?? (scheduled ? item.quantity : 0)), 0);
    const allocation = scheduled ? '<p><b>' + reserved + ' geladinho(s) já foram separados.</b>' + (pending > 0 ? '<br>' + pending + ' geladinho(s) ficaram programados para produção.' : '') + '</p>' : '';
    root.innerHTML = '<section class="hero">' + managementBack() + '<h1>Pedido recebido</h1><p>' + (scheduled ? 'Recebemos sua encomenda e já separamos automaticamente tudo o que estava pronto.' : 'Recebemos seu pedido e reservamos os geladinhos selecionados temporariamente.') + '</p></section><section class="panel confirmation"><h2>Total: ' + money.format(num(result.total)) + '</h2><p>Pedido nº ' + esc(result.orderId) + '. A Gelatos Lele confirmará os próximos passos pelo WhatsApp informado.</p>' + schedule + allocation + reservation + freight + '<button class="primary" id="newOrder">Fazer outro pedido</button></section>';
    document.getElementById('newOrder')?.addEventListener('click', () => {
      orderAttemptId = '';
      sessionStorage.removeItem(ORDER_ATTEMPT_KEY);
      loadCatalog();
    });
  }
  function reviewOrder() {
    syncDraft(document.getElementById('customerOrder'));
    const error = validateOrderDraft(orderTotals());
    if (error) { alert(error); return; }
    if (!orderAttemptId) {
      orderAttemptId = sessionStorage.getItem(ORDER_ATTEMPT_KEY) || newAttemptId();
      sessionStorage.setItem(ORDER_ATTEMPT_KEY, orderAttemptId);
    }
    reviewing = true;
    render();
    root.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  async function submitOrder() {
    const result = orderTotals();
    const error = validateOrderDraft(result);
    if (error) { alert(error); reviewing = false; render(); return; }
    const button = document.querySelector('#customerOrder button.primary');
    if (button) { button.disabled = true; button.textContent = 'Confirmando pedido…'; }
    try {
      const saved = await window.GelatosCloud.placeCustomerOrder({ requestId: orderAttemptId, clientId: customerClientId(), customer: draft.customer.trim(), phone: draft.phone.trim(), mode: draft.mode, zoneId: draft.zoneId, address: draft.address.trim(), payment: draft.payment, orderKind: draft.orderKind, scheduledFor: isScheduled() ? draft.scheduledFor : '', items: result.selected.map(product => ({ productId: product.id, quantity: quantities[product.id] })) });
      applyConfirmedStock(saved);
      confirmation(saved);
    } catch (error) {
      if (button) { button.disabled = false; button.textContent = 'Confirmar pedido'; }
      alert((error.message || 'Não foi possível confirmar o pedido.') + ' Vamos conferir o cardápio sem perder este pedido; tente confirmar novamente somente se ele não aparecer como confirmado.');
      loadCatalog(true);
    }
  }
  async function loadCatalog(preserveDraft = false) {
    root.innerHTML = '<section class="error"><b>Carregando cardápio…</b><br>Estamos conferindo os sabores disponíveis.</section>';
    try { start(await window.GelatosCloud.getCatalog(), preserveDraft); }
    catch (_) {
      const legacy = legacyCatalog();
      if (legacy) { start(legacy, preserveDraft); return; }
      root.innerHTML = '<section class="error"><b>Não foi possível abrir o cardápio agora.</b><br>Confira sua internet e tente novamente.</section>';
    }
  }
  document.addEventListener('click', event => {
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (action === 'back-customer') {
      if (history.length > 1) history.back(); else location.href = managementUrl();
      return;
    }
    if (action === 'choose-product') {
      syncDraft(document.getElementById('customerOrder'));
      const id = event.target.closest('[data-product]')?.dataset.product;
      selectedProductId = String(selectedProductId) === String(id) ? '' : id;
      reviewing = false;
      render();
      return;
    }
    if (action === 'choose-order-kind') {
      syncDraft(document.getElementById('customerOrder'));
      draft.orderKind = event.target.closest('[data-kind]')?.dataset.kind === 'scheduled' && scheduledEnabled() ? 'scheduled' : 'ready';
      if (isScheduled() && draft.scheduledFor < scheduledMinDate()) draft.scheduledFor = scheduledMinDate();
      if (!isScheduled()) Object.keys(quantities).forEach(id => { const product = catalog.products.find(item => String(item.id) === String(id)); quantities[id] = Math.min(quantities[id], availability(product)); });
      reviewing = false;
      render();
      return;
    }
    if (action === 'toggle-category') {
      syncDraft(document.getElementById('customerOrder'));
      const id = event.target.closest('[data-category]')?.dataset.category;
      openCategoryId = String(openCategoryId) === String(id) ? '' : String(id || '');
      selectedProductId = '';
      reviewing = false;
      render();
      return;
    }
    if (action === 'edit-checkout') { reviewing = false; render(); return; }
    const button = event.target.closest('[data-change]');
    if (!button || !catalog) return;
    syncDraft(document.getElementById('customerOrder'));
    const [id, change] = button.dataset.change.split(':');
    const product = catalog.products.find(item => String(item.id) === String(id));
    quantities[id] = Math.max(0, Math.min(isScheduled() ? 99 : availability(product), quantities[id] + Number(change)));
    reviewing = false;
    render();
  });
  document.addEventListener('change', event => {
    if (!event.target.closest('#customerOrder')) return;
    syncDraft(document.getElementById('customerOrder'));
    if (event.target.name === 'mode' || event.target.name === 'zoneId' || event.target.name === 'scheduledFor') { reviewing = false; render(); }
  });
  document.addEventListener('input', event => { if (event.target.closest('#customerOrder')) { syncDraft(document.getElementById('customerOrder')); reviewing = false; } });
  document.addEventListener('submit', event => {
    if (event.target.id !== 'customerOrder') return;
    event.preventDefault();
    syncDraft(event.target);
    if (reviewing) submitOrder(); else reviewOrder();
  });
  loadCatalog();
})();
