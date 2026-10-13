// Floor map: one zone per section (section color), tables laid out inside it.
// Shape follows seat type; ring color follows live status.
const FloorMap = (() => {
  const SLOT = [
    { left: 8, top: 14, w: 26, h: 30 },   // table
    { left: 44, top: 10, w: 50, h: 26 },  // booth (wide)
    { left: 8, top: 60, w: 18, h: 26 },   // bar seat
    { left: 52, top: 54, w: 26, h: 30 },  // table
  ];

  function alertCount(table, complaints) {
    const reqs = table.requests.filter((r) => r.status === 'open' || r.status === 'accepted').length;
    const cmp = (complaints || []).filter((c) => c.tableId === table.id && c.status === 'open').length;
    const ready = [...table.drinkOrders, ...table.foodOrders].filter((o) => o.status === 'ready').length;
    return reqs + cmp + ready;
  }

  // The actual icons for what's pending — napkins, ketchup, bill/check, etc.
  // — so a waiter can scan the whole section and see who needs what without
  // opening a single card.
  function pendingIcons(table, requestTypes) {
    const seen = new Set();
    return table.requests
      .filter((r) => r.status === 'open' || r.status === 'accepted')
      .filter((r) => {
        if (seen.has(r.type)) return false;
        seen.add(r.type);
        return true;
      })
      .map((r) => (requestTypes[r.type] || {}).icon)
      .filter(Boolean);
  }

  function stateOf(table) {
    if (table.status === 'needs_greeting') return 'greet';
    if (table.status === 'seated' && table.greetedAt === null) return 'greet'; // seated, but nobody has been over yet
    if (table.status === 'empty') return 'empty';
    if (table.bill && !table.bill.paid) return 'billing';
    return 'seated';
  }

  // opts.highlightSectionId dims every other section (waiter view).
  function render(container, { tables, sections, seatTypes, complaints, requestTypes }, opts = {}) {
    container.innerHTML = '';
    container.className = 'floor-map';
    sections.forEach((section) => {
      const zone = document.createElement('div');
      zone.className = 'floor-zone';
      zone.style.borderColor = section.color;
      zone.style.background = section.color + '14';
      if (opts.highlightSectionId && opts.highlightSectionId !== section.id) zone.classList.add('dim');

      const label = document.createElement('div');
      label.className = 'floor-zone-label';
      label.style.color = section.color;
      label.textContent = section.name;
      zone.appendChild(label);

      Object.values(tables)
        .filter((t) => t.sectionId === section.id)
        .sort((a, b) => a.number - b.number)
        .forEach((table, i) => {
          const slot = SLOT[i % SLOT.length];
          const node = document.createElement('div');
          node.className = `floor-table ${table.seatType} ${stateOf(table)}`;
          node.style.cssText = `left:${slot.left}%; top:${slot.top}%; width:${slot.w}%; height:${slot.h}%;`;
          const alerts = alertCount(table, complaints);
          const icons = requestTypes ? pendingIcons(table, requestTypes) : [];
          node.innerHTML =
            `<b>${table.number}</b><span>${seatTypes[table.seatType].icon}</span>` +
            (icons.length ? `<i class="floor-needs">${icons.join(' ')}</i>` : '') +
            (alerts ? `<i class="floor-badge">${alerts}</i>` : '');
          node.title = `Table ${table.number} — ${seatTypes[table.seatType].label}`;
          zone.appendChild(node);
        });
      container.appendChild(zone);
    });

    const legend = document.createElement('div');
    legend.className = 'floor-legend';
    legend.innerHTML =
      '<span><i class="lg empty"></i>Open</span><span><i class="lg greet"></i>Needs greeting</span>' +
      '<span><i class="lg seated"></i>Seated</span><span><i class="lg billing"></i>Bill out</span>' +
      '<span><i class="floor-badge sm">1</i>Alerts</span>';
    container.appendChild(legend);
  }

  return { render };
})();
