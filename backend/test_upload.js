const rows = [
  { sales: 400, inventory: 800, price: 4500, month: 8, lead_time: 7, demand: 500 },
  { sales: 450, inventory: 750, price: 4400, month: 9, lead_time: 7, demand: 560 },
  { sales: 500, inventory: 700, price: 4300, month: 10, lead_time: 7, demand: 620 },
];
fetch('http://localhost:4000/api/upload-forecast', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ rows })
}).then(r => r.json()).then(d => {
  console.log('keys:', Object.keys(d));
  console.log('predicted_demand:', d.predicted_demand);
  console.log('detail:', d.detail || d.error || 'none');
}).catch(e => console.error(e));
