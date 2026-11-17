// Airports and cities for demo mode. region: zm = Zambia, af = rest of Africa, int = intercontinental.
export const PLACES = [
  ['LUN', 'Lusaka', 'Kenneth Kaunda International', 'Zambia', 'zm'],
  ['NLA', 'Ndola', 'Simon Mwansa Kapwepwe International', 'Zambia', 'zm'],
  ['LVI', 'Livingstone', 'Harry Mwanga Nkumbula International', 'Zambia', 'zm'],
  ['MFU', 'Mfuwe', 'Mfuwe International (South Luangwa)', 'Zambia', 'zm'],
  ['SLI', 'Solwezi', 'Solwezi', 'Zambia', 'zm'],
  ['KMZ', 'Kasama', 'Kasama', 'Zambia', 'zm'],
  ['CIP', 'Chipata', 'Chipata', 'Zambia', 'zm'],
  ['MNR', 'Mongu', 'Mongu', 'Zambia', 'zm'],
  ['VFA', 'Victoria Falls', 'Victoria Falls International', 'Zimbabwe', 'af'],
  ['HRE', 'Harare', 'Robert Gabriel Mugabe International', 'Zimbabwe', 'af'],
  ['JNB', 'Johannesburg', 'O.R. Tambo International', 'South Africa', 'af'],
  ['CPT', 'Cape Town', 'Cape Town International', 'South Africa', 'af'],
  ['NBO', 'Nairobi', 'Jomo Kenyatta International', 'Kenya', 'af'],
  ['ADD', 'Addis Ababa', 'Bole International', 'Ethiopia', 'af'],
  ['DAR', 'Dar es Salaam', 'Julius Nyerere International', 'Tanzania', 'af'],
  ['LLW', 'Lilongwe', 'Kamuzu International', 'Malawi', 'af'],
  ['WDH', 'Windhoek', 'Hosea Kutako International', 'Namibia', 'af'],
  ['DXB', 'Dubai', 'Dubai International', 'United Arab Emirates', 'int'],
  ['DOH', 'Doha', 'Hamad International', 'Qatar', 'int'],
  ['LHR', 'London', 'Heathrow', 'United Kingdom', 'int'],
  ['JFK', 'New York', 'John F. Kennedy International', 'United States', 'int'],
  ['DEL', 'Delhi', 'Indira Gandhi International', 'India', 'int'],
  ['BOM', 'Mumbai', 'Chhatrapati Shivaji Maharaj International', 'India', 'int'],
].map(([code, city, name, country, region]) => ({ code, city, name, country, region }));

export const byCode = (code) => PLACES.find((p) => p.code === code);
export const regionOf = (code) => byCode(code)?.region || 'int';
