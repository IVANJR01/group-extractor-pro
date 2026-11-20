async function testConnect() {
  try {
    const res = await fetch('http://localhost:5173/api/robot/status');
    const data = await res.json();
    console.log('Status atual:', data.chips[0]);
  } catch (err) {
    console.error('Erro:', err.message);
  }
}
testConnect();
