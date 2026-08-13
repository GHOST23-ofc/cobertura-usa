export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const { address } = req.query;
  if (!address) {
    return res.status(400).json({ error: "Ingresa una dirección." });
  }

  const TELCOS_CATALOG = {
    "AT&T": ["AT&T", "SBC", "BELLSOUTH"],
    "OPTIMUM": ["OPTIMUM", "ALTICE", "CABLEVISION", "SUDDENLINK"],
    "SPECTRUM": ["CHARTER", "SPECTRUM", "TIME WARNER"],
    "XFINITY": ["COMCAST", "XFINITY"],
    "FRONTIER": ["FRONTIER"],
    "EARTHLINK": ["EARTHLINK"],
    "BRIGHTSPEED": ["BRIGHTSPEED", "CONNECT HOLDING", "CENTURYLINK"],
    "WOW!": ["WIDEOPENWEST", "WOW!"],
    "ZIPLY FIBER": ["ZIPLY", "NORTHWEST FIBER"],
    "ALTAFIBER": ["ALTAFIBER", "CINCINNATI BELL"],
    "FIDIUM FIBER": ["FIDIUM", "CONSOLIDATED COMMUNICATIONS"],
    "HAWAIIAN TELCOM": ["HAWAIIAN TELCOM"]
  };

  const headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
  };

  try {
    // 1. Geocodificación y Normalización oficial con US Census Bureau API
    const censusUrl = `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=${encodeURIComponent(address)}&benchmark=2020&format=json`;
    const censusRes = await fetch(censusUrl, { headers });
    const censusData = await censusRes.json();

    const matches = censusData?.result?.addressMatches;
    if (!matches || matches.length === 0) {
      return res.status(404).json({ error: "No se pudo normalizar la dirección. Revisa el número de calle y el ZIP code." });
    }

    const matchedAddress = matches[0].matchedAddress;
    const { x: lon, y: lat } = matches[0].coordinates;

    // 2. Obtener Location ID en la FCC
    const fccLocUrl = `https://broadbandmap.fcc.gov/api/public/map/listLocationByCoordinates?latitude=${lat}&longitude=${lon}`;
    const fccLocRes = await fetch(fccLocUrl, { headers });
    const fccLocData = await fccLocRes.json();

    const locations = fccLocData?.data || [];
    if (locations.length === 0) {
      return res.status(404).json({ error: "No hay infraestructura de telecomunicaciones registrada en este predio." });
    }

    const locationId = locations[0].location_id;

    // 3. Consultar Disponibilidad exacta por Location ID
    const fccAvailUrl = `https://broadbandmap.fcc.gov/api/public/map/listAvailabilityByLocationId/${locationId}`;
    const fccAvailRes = await fetch(fccAvailUrl, { headers });
    const fccAvailData = await fccAvailRes.json();

    const rawServices = fccAvailData?.data || [];
    const resultsByProvider = {};

    rawServices.forEach(s => {
      const fullText = `${s.provider_name || ''} ${s.brand_name || ''}`.toUpperCase();
      
      for (const [brand, aliases] of Object.entries(TELCOS_CATALOG)) {
        if (aliases.some(alias => fullText.includes(alias))) {
          const tech = s.technology_description || 'Desconocida';
          const down = s.max_advertised_download_speed || 0;
          const up = s.max_advertised_upload_speed || 0;
          const isFiber = tech.toUpperCase().includes('FIBER') || tech.toUpperCase().includes('OPTICAL') || tech.toUpperCase().includes('FTTH');
          const isCable = tech.toUpperCase().includes('CABLE') || tech.toUpperCase().includes('COAXIAL');
          const isWireless = tech.toUpperCase().includes('WIRELESS') || tech.toUpperCase().includes('AIR') || tech.toUpperCase().includes('5G');

          let techName = isFiber ? 'FIBRA ÓPTICA (FTTH)' : (isCable ? 'CABLE COAXIAL' : (isWireless ? 'INALÁMBRICO / AIR' : tech));

          if (!resultsByProvider[brand]) {
            resultsByProvider[brand] = [];
          }

          resultsByProvider[brand].push({
            techName,
            downSpeed: down,
            upSpeed: up,
            isFiber,
            isCable,
            isWireless
          });
          break;
        }
      }
    });

    return res.status(200).json({
      address: matchedAddress,
      coordinates: { lat, lon },
      providers: resultsByProvider
    });

  } catch (err) {
    return res.status(500).json({ error: "Error de servidor: " + err.message });
  }
}
