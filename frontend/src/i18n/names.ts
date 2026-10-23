// Localised names for the synthetic mine's nodes and segments (ids stay Latin).
type Dict = Record<string, string>;
const JN = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `J-0${n}`);

function build(j: string, de: string, oldw: string, exit: string, shaft: string, raise: string, portal: string, s: string[]): Dict {
  const d: Dict = { PORTAL: portal, "DE-01": `${de} DE-01`, "DE-02": `${de} DE-02 (${oldw})`, "X-02": `${exit} X-02 (${shaft})`, "X-03": `${exit} X-03 (${raise})` };
  for (const id of JN) d[id] = `${j} ${id}`;
  s.forEach((v, i) => { d[`S${String(i + 1).padStart(2, "0")}`] = v; });
  return d;
}

const en = build("Junction", "Dead End", "Old Workings", "Emergency Exit", "Shaft", "Raise Bore", "Portal (Main Entrance)", [
  "Main Tunnel A (Portal Drift)", "Main Tunnel B", "Main Tunnel C", "Main Tunnel D", "Main Tunnel E (Dead End)", "North Branch 1", "North Cross-cut", "North Link",
  "Old Workings (Restricted)", "South Branch", "South Exit Drift", "East Branch", "East Cross-cut", "East Link", "East Raise Drift", "North-East Link"]);
const hi = build("जंक्शन", "बंद सिरा", "पुराने कार्य-क्षेत्र", "आपातकालीन निकास", "शाफ़्ट", "रेज़ बोर", "पोर्टल (मुख्य प्रवेश)", [
  "मुख्य सुरंग A (पोर्टल ड्रिफ़्ट)", "मुख्य सुरंग B", "मुख्य सुरंग C", "मुख्य सुरंग D", "मुख्य सुरंग E (बंद सिरा)", "उत्तर शाखा 1", "उत्तर क्रॉस-कट", "उत्तर संपर्क",
  "पुराने कार्य-क्षेत्र (प्रतिबंधित)", "दक्षिण शाखा", "दक्षिण निकास ड्रिफ़्ट", "पूर्व शाखा", "पूर्व क्रॉस-कट", "पूर्व संपर्क", "पूर्व रेज़ ड्रिफ़्ट", "उत्तर-पूर्व संपर्क"]);
const mr = build("जंक्शन", "बंद टोक", "जुनी कामाची जागा", "आपत्कालीन निर्गमन", "शाफ्ट", "रेज बोअर", "पोर्टल (मुख्य प्रवेशद्वार)", [
  "मुख्य बोगदा A (पोर्टल ड्रिफ्ट)", "मुख्य बोगदा B", "मुख्य बोगदा C", "मुख्य बोगदा D", "मुख्य बोगदा E (बंद टोक)", "उत्तर फाटा 1", "उत्तर क्रॉस-कट", "उत्तर जोड",
  "जुनी कामाची जागा (प्रतिबंधित)", "दक्षिण फाटा", "दक्षिण निर्गमन ड्रिफ्ट", "पूर्व फाटा", "पूर्व क्रॉस-कट", "पूर्व जोड", "पूर्व रेज ड्रिफ्ट", "ईशान्य जोड"]);
const or = build("ଜଙ୍କ୍ସନ୍", "ବନ୍ଦ ଶେଷ", "ପୁରୁଣା କାର୍ଯ୍ୟକ୍ଷେତ୍ର", "ଜରୁରୀକାଳୀନ ବାହାରିବା ପଥ", "ଶାଫ୍ଟ", "ରେଜ୍ ବୋର୍", "ପୋର୍ଟାଲ୍ (ମୁଖ୍ୟ ପ୍ରବେଶ)", [
  "ମୁଖ୍ୟ ସୁଡ଼ଙ୍ଗ A (ପୋର୍ଟାଲ୍ ଡ୍ରିଫ୍ଟ)", "ମୁଖ୍ୟ ସୁଡ଼ଙ୍ଗ B", "ମୁଖ୍ୟ ସୁଡ଼ଙ୍ଗ C", "ମୁଖ୍ୟ ସୁଡ଼ଙ୍ଗ D", "ମୁଖ୍ୟ ସୁଡ଼ଙ୍ଗ E (ବନ୍ଦ ଶେଷ)", "ଉତ୍ତର ଶାଖା 1", "ଉତ୍ତର କ୍ରସ୍-କଟ୍", "ଉତ୍ତର ସଂଯୋଗ",
  "ପୁରୁଣା କାର୍ଯ୍ୟକ୍ଷେତ୍ର (ପ୍ରତିବନ୍ଧିତ)", "ଦକ୍ଷିଣ ଶାଖା", "ଦକ୍ଷିଣ ବାହାରିବା ଡ୍ରିଫ୍ଟ", "ପୂର୍ବ ଶାଖା", "ପୂର୍ବ କ୍ରସ୍-କଟ୍", "ପୂର୍ବ ସଂଯୋଗ", "ପୂର୍ବ ରେଜ୍ ଡ୍ରିଫ୍ଟ", "ଉତ୍ତର-ପୂର୍ବ ସଂଯୋଗ"]);

export const NAMES: Record<"en" | "hi" | "mr" | "or", Dict> = { en, hi, mr, or };
