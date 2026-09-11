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
  let catalog = null;
  let quantities = {};
  let draft = { customer: '', mode: 'Retirada', zoneId: '', address: '', payment: 'Pix' };
  const managementUrl = () => location.origin + location.pathname.replace(/[^/]*$/, '') + 'index.html?v=25';

  function legacyCatalog() {
    try {
      const fragment = location.hash.replace(/^#c=/, '');
      if (!fragment) return null;
      const parsed = JSON.parse(decodeURIComponent(escape(atob(fragment))));
      return Array.isArray(parsed?.products) ? parsed : null;
    } catch (_) { return null; }
  }
  function start(nextCatalog) {
    catalog = nextCatalog;
    quantities = Object.fromEntries(catalog.products.map(product => [product.id, 0]));
    const modes = availableModes();
    draft = { customer: '', mode: modes[0] || 'Retirada', zoneId: deliveryZones()[0]?.id || '', address: '', payment: 'Pix' };
    render();
  }
  function availableModes() { return String(catalog?.deliveryModes || 'Retirada,Entrega').split(',').map(mode => mode.trim()).filter(Boolean); }
  function deliveryZones() { return (Array.isArray(catalog?.deliveryZones) ? catalog.deliveryZones : []).map((zone, index) => ({ id: String(zone.id || index), name: String(zone.name || '').trim(), fee: Math.max(0, num(zone.fee)) })).filter(zone => zone.name); }
  function selectedProducts() { return catalog.products.filter(product => quantities[product.id] > 0); }
  function applyConfirmedStock() {
    selectedProducts().forEach(product => {
      product.available = Math.max(0, num(product.available) - num(quantities[product.id]));
    });
  }
  function isDelivery() { return String(draft.mode || '').toLocaleLowerCase('pt-BR').includes('entrega'); }
  function syncDraft(form) {
    if (!form) return;
    const f = form.elements;
    if (f.customer) draft.customer = f.customer.value;
    if (f.mode) draft.mode = f.mode.value;
    if (f.zoneId) draft.zoneId = f.zoneId.value;
    if (f.address) draft.address = f.address.value;
    if (f.payment) draft.payment = f.payment.value;
  }
  function orderTotals() {
    const selected = selectedProducts();
    const quantity = selected.reduce((sum, product) => sum + quantities[product.id], 0);
    const subtotal = selected.reduce((sum, product) => sum + num(product.price) * quantities[product.id], 0);
    const zone = deliveryZones().find(item => String(item.id) === String(draft.zoneId));
    const freeByValue = num(catalog.freeDeliveryMinValue) > 0 && subtotal >= num(catalog.freeDeliveryMinValue);
    const freeByQuantity = num(catalog.freeDeliveryMinItems) > 0 && quantity >= num(catalog.freeDeliveryMinItems);
    const delivery = isDelivery(); const free = delivery && (freeByValue || freeByQuantity);
    const fee = delivery && zone && !free && quantity > 0 ? zone.fee : 0;
    return { selected, quantity, subtotal, zone, delivery, free, fee, freeReason: freeByValue ? 'Frete grátis por valor mínimo' : freeByQuantity ? 'Frete grátis por quantidade mínima' : '', total: subtotal + fee };
  }
  function render() {
    const result = orderTotals(); const zones = deliveryZones(); const modes = availableModes();
    const zoneField = result.delivery ? '<label>Local de entrega<select name="zoneId" required>' + (zones.length ? zones.map(zone => '<option value="' + esc(zone.id) + '"' + (String(zone.id) === String(draft.zoneId) ? ' selected' : '') + '>' + esc(zone.name) + ' · frete ' + money.format(zone.fee) + '</option>').join('') : '<option value="">Frete a combinar</option>') + '</select></label>' : '';
    const freightText = !result.quantity ? 'Selecione os sabores' : !result.delivery ? 'R$ 0,00 (retirada)' : result.free ? 'Grátis' : result.zone ? money.format(result.fee) : 'A combinar';
    const pickupNotice = !result.delivery && String(catalog.pickupAddress || '').trim() ? '<section class="notice"><b>Endereço para retirada:</b><br>' + esc(catalog.pickupAddress).replace(/\n/g, '<br>') + '</section>' : '';
    const addressLabel = result.delivery ? 'Endereço de entrega / observação' : 'Observação para retirada (opcional)';
    const addressPlaceholder = result.delivery ? 'Informe o endereço completo e uma referência.' : 'Ex.: horário desejado para retirar.';
    root.innerHTML = '<section class="hero"><button type="button" class="back-app" data-action="back-customer">← Voltar</button><h1>' + esc(catalog.brand || 'Gelatos Lele') + '</h1><p>' + esc(catalog.intro || 'Confira os sabores disponíveis.') + '</p></section>' +
      (catalog.address ? '<section class="notice"><b>Informações:</b><br>' + esc(catalog.address).replace(/\n/g, '<br>') + '</section>' : '') +
      pickupNotice +
      '<section class="products">' + (catalog.products.length ? catalog.products.map(product => '<article class="product">' + (product.image ? '<img src="' + esc(product.image) + '" alt="' + esc(product.name) + '">' : '<div class="image-placeholder"></div>') + '<div><h2>' + esc(product.name) + '</h2><p>' + esc(product.description || 'Geladinho artesanal.') + '</p><span class="price">' + money.format(num(product.price)) + ' · ' + product.available + ' disponível(is)</span><div class="quantity"><button data-change="' + esc(product.id) + ':-1" aria-label="Diminuir">−</button><b>' + quantities[product.id] + '</b><button data-change="' + esc(product.id) + ':1" aria-label="Aumentar">+</button></div></div></article>').join('') : '<p class="empty">Nenhum sabor disponível neste momento.</p>') + '</section>' +
      '<form id="customerOrder" class="panel"><h2>Finalizar pedido</h2><label>Seu nome<input name="customer" required value="' + esc(draft.customer) + '" placeholder="Ex.: Maria"></label><label>Forma de receber<select name="mode">' + modes.map(mode => '<option' + (mode === draft.mode ? ' selected' : '') + '>' + esc(mode) + '</option>').join('') + '</select></label>' + zoneField + '<label>' + addressLabel + '<textarea name="address" placeholder="' + addressPlaceholder + '">' + esc(draft.address) + '</textarea></label><label>Forma de pagamento<select name="payment"><option' + (draft.payment === 'Pix' ? ' selected' : '') + '>Pix</option><option' + (draft.payment === 'Dinheiro' ? ' selected' : '') + '>Dinheiro</option><option' + (draft.payment === 'Crédito' ? ' selected' : '') + '>Crédito</option><option' + (draft.payment === 'Débito' ? ' selected' : '') + '>Débito</option></select></label><div class="total total-breakdown"><span>Subtotal dos geladinhos</span><b>' + money.format(result.subtotal) + '</b><span>Frete' + (result.freeReason ? ' · ' + esc(result.freeReason) : '') + '</span><b>' + freightText + '</b><strong>Valor total</strong><strong>' + money.format(result.total) + '</strong></div><button class="primary">Confirmar pedido</button><p class="small">O pedido entra diretamente no sistema da Gelatos Lele e o estoque é reservado.</p></form>';
  }
  function confirmation(result) {
    root.innerHTML = '<section class="hero"><button type="button" class="back-app" data-action="back-customer">← Voltar</button><h1>Pedido confirmado</h1><p>Recebemos seu pedido e reservamos os geladinhos selecionados.</p></section><section class="panel"><h2>Total: ' + money.format(num(result.total)) + '</h2><p>Pedido nº ' + esc(result.orderId) + '. A Gelatos Lele confirmará os próximos passos.</p><button class="primary" id="newOrder">Fazer outro pedido</button></section>';
    document.getElementById('newOrder')?.addEventListener('click', () => start(catalog));
  }
  async function submitOrder() {
    const result = orderTotals();
    if (!draft.customer.trim()) { alert('Informe seu nome.'); return; }
    if (!result.selected.length) { alert('Escolha pelo menos um sabor.'); return; }
    if (result.delivery && deliveryZones().length && !result.zone) { alert('Escolha o local de entrega.'); return; }
    const button = document.querySelector('#customerOrder button.primary');
    if (button) { button.disabled = true; button.textContent = 'Confirmando pedido…'; }
    try {
      const saved = await window.GelatosCloud.placeCustomerOrder({ customer: draft.customer.trim(), mode: draft.mode, zoneId: draft.zoneId, address: draft.address.trim(), payment: draft.payment, items: result.selected.map(product => ({ productId: product.id, quantity: quantities[product.id] })) });
      applyConfirmedStock();
      confirmation(saved);
    } catch (error) {
      if (button) { button.disabled = false; button.textContent = 'Confirmar pedido'; }
      alert(error.message || 'Não foi possível confirmar o pedido. Atualize a página e tente novamente.');
      loadCatalog();
    }
  }
  async function loadCatalog() {
    root.innerHTML = '<section class="error"><b>Carregando cardápio…</b><br>Estamos conferindo os sabores disponíveis.</section>';
    try { start(await window.GelatosCloud.getCatalog()); }
    catch (_) {
      const legacy = legacyCatalog();
      if (legacy) { start(legacy); return; }
      root.innerHTML = '<section class="error"><b>Não foi possível abrir o cardápio agora.</b><br>Confira sua internet e tente novamente.</section>';
    }
  }
  document.addEventListener('click', event => {
    if (event.target.closest('[data-action="back-customer"]')) {
      if (history.length > 1) history.back();
      else location.href = managementUrl();
      return;
    }
    const button = event.target.closest('[data-change]'); if (!button || !catalog) return;
    syncDraft(document.getElementById('customerOrder'));
    const [id, change] = button.dataset.change.split(':'); const product = catalog.products.find(item => String(item.id) === String(id));
    quantities[id] = Math.max(0, Math.min(num(product.available), quantities[id] + Number(change))); render();
  });
  document.addEventListener('change', event => { if (event.target.closest('#customerOrder')) { syncDraft(document.getElementById('customerOrder')); if (event.target.name === 'mode' || event.target.name === 'zoneId') render(); } });
  document.addEventListener('input', event => { if (event.target.closest('#customerOrder')) syncDraft(document.getElementById('customerOrder')); });
  document.addEventListener('submit', event => { if (event.target.id === 'customerOrder') { event.preventDefault(); syncDraft(event.target); submitOrder(); } });
  loadCatalog();
})();
