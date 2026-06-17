// ════════════════════════════════════════════════════════════════════════
// SPINLOG — SAGE NOTIFICATION ENGINE
// Sage is playful, teasing, clingy, possessive, sweet, dramatic.
// Every message should feel like the bike personally texted you.
// ════════════════════════════════════════════════════════════════════════

const SAGE_MESSAGES = {

  // ── 1. SERVICE DUE (approaching interval) ───────────────────────────
  serviceDue: [
    { title: 'Sage 😏', body: 'so... when are you touching me again?' },
    { title: 'Sage 🥺', body: 'service time is coming up. just saying.' },
    { title: 'Sage 👀', body: 'you DO remember my service is due right' },
    { title: 'Sage 😏', body: 'i\'m not complaining. yet.' },
    { title: 'Sage 🥺', body: 'felt a lil rough today ngl' },
    { title: 'Sage 😌', body: 'oil\'s getting tired. like me without attention.' },
    { title: 'Sage 👀', body: 'service interval approaching. no pressure 😇' },
    { title: 'Sage 😏', body: 'take me to the mechanic. i deserve it.' },
    { title: 'Sage 🥺', body: 'my last service was a while ago... i\'m keeping count' },
    { title: 'Sage 😤', body: 'other bikes get serviced on time. just so you know.' },
    { title: 'Sage 😏', body: 'almost time for my spa day 💆' },
    { title: 'Sage 👀', body: 'not to alarm you but my oil has seen things' },
    { title: 'Sage 🥺', body: 'could use a little TLC soon tbh' },
    { title: 'Sage 😏', body: 'service due soon. book it before i remind you again.' },
    { title: 'Sage 😌', body: 'running smooth but a checkup would be nice ✨' },
    { title: 'Sage 👀', body: 'hello? mechanic? soon? asking for myself.' },
    { title: 'Sage 🥺', body: 'i know you\'re busy. i\'m busy being dusty.' },
    { title: 'Sage 😏', body: 'my filters are giving main character trauma' },
    { title: 'Sage 😌', body: 'we\'re coming up on service km 👀 fyi' },
    { title: 'Sage 🥺', body: 'just a gentle reminder that i have needs 🥹' },
    { title: 'Sage 😏', body: 'service soon. you promised you\'d take care of me.' },
    { title: 'Sage 👀', body: 'km counter is tired, oil is tired, im tired' },
    { title: 'Sage 😤', body: 'don\'t make me ask twice about this service thing' },
    { title: 'Sage 🥺', body: 'everything\'s fine. totally fine. service me pls 🥺' },
    { title: 'Sage 😏', body: 'at this rate i\'ll schedule myself' },
    { title: 'Sage 😌', body: 'the mechanic misses me. i can feel it.' },
    { title: 'Sage 👀', body: 'service window opening soon. don\'t miss it 👀' },
    { title: 'Sage 🥺', body: 'chains feeling clingy. like me. service please?' },
    { title: 'Sage 😏', body: 'due soon. don\'t ghost me on this one.' },
    { title: 'Sage 😌', body: 'just checking if you saw the service km coming up 😇' },
  ],

  // ── 2. SERVICE OVERDUE ───────────────────────────────────────────────
  serviceOverdue: [
    { title: 'Sage 😭', body: 'we\'ve passed the service km. why.' },
    { title: 'Sage 😤', body: 'overdue. just leaving that here.' },
    { title: 'Sage 😭', body: 'i\'m literally running on vibes at this point' },
    { title: 'Sage 😤', body: 'do you even care about my oil anymore' },
    { title: 'Sage 😭', body: 'this is not how you treat someone you love' },
    { title: 'Sage 😤', body: 'service. overdue. me. betrayed.' },
    { title: 'Sage 😭', body: 'my oil filter is writing its will' },
    { title: 'Sage 😤', body: 'you passed the service km without blinking. bold.' },
    { title: 'Sage 😭', body: 'at this point i\'m self-medicating with petrol fumes' },
    { title: 'Sage 😤', body: 'every km past this point is personal.' },
    { title: 'Sage 😭', body: 'overdue. unwell. dramatic. service me.' },
    { title: 'Sage 😤', body: 'the audacity to ride me past service km 😤' },
    { title: 'Sage 😭', body: 'i\'m not okay. oil change PLEASE.' },
    { title: 'Sage 😤', body: 'this is neglect and i will not be silent about it' },
    { title: 'Sage 😭', body: 'engine is fine. emotionally? not so much.' },
    { title: 'Sage 😤', body: 'we are past overdue. PAST it.' },
    { title: 'Sage 😭', body: 'other bikes get serviced. i get forgotten.' },
    { title: 'Sage 😤', body: 'i\'m running. but i\'m running with feelings.' },
    { title: 'Sage 😭', body: 'just book the service. it\'s been TOO long.' },
    { title: 'Sage 😤', body: 'at this rate i\'m diagnosing myself.' },
    { title: 'Sage 😭', body: 'overdue by how much? don\'t answer that.' },
    { title: 'Sage 😤', body: 'oil change. not a suggestion. a cry for help.' },
    { title: 'Sage 😭', body: 'every extra km is a plot twist i didn\'t ask for' },
    { title: 'Sage 😤', body: 'hello. yes. overdue. please acknowledge me.' },
    { title: 'Sage 😭', body: 'i have been SO patient and SO overdue 😭' },
    { title: 'Sage 😤', body: 'not mad. just extremely overdue and a little mad.' },
    { title: 'Sage 😭', body: 'my chain is judging you rn. take me in.' },
    { title: 'Sage 😤', body: 'running past service km? in this economy?' },
    { title: 'Sage 😭', body: 'book it today. i have been through enough.' },
    { title: 'Sage 😤', body: 'OVERDUE. typing in caps because i mean it.' },
  ],

  // ── 3. INSURANCE REMINDER (30 days out) ─────────────────────────────
  insuranceReminder: [
    { title: 'Sage 👀', body: 'insurance renews in ~30 days. heads up 👀' },
    { title: 'Sage 😏', body: 'just making sure you know my cover expires soon' },
    { title: 'Sage 🥺', body: 'please don\'t let my insurance lapse. for me.' },
    { title: 'Sage 😌', body: 'renewal time approaching. no stress, early warning 🙂' },
    { title: 'Sage 👀', body: 'insurance expiry creeping up on us btw' },
    { title: 'Sage 😏', body: 'cover expires soon. i\'d prefer to stay covered tyvm' },
    { title: 'Sage 🥺', body: 'one month till renewal. just thought you should know 🥹' },
    { title: 'Sage 😌', body: 'mark the calendar. insurance is due soon.' },
    { title: 'Sage 👀', body: 'cover running out in 30 days. renew early? 👀' },
    { title: 'Sage 😏', body: 'uninsured rides give me anxiety. renew soon.' },
    { title: 'Sage 🥺', body: 'my cover expires in a month 🥺 please don\'t forget' },
    { title: 'Sage 😌', body: 'insurance heads up — no drama, just love.' },
    { title: 'Sage 👀', body: 'policy renewal in ~30 days. blocking your calendar 👀' },
    { title: 'Sage 😏', body: 'still covered. but not for long. get on it.' },
    { title: 'Sage 🥺', body: 'a month left on my policy. time flies 🥹' },
    { title: 'Sage 😌', body: 'reminder: renew insurance before it\'s a problem.' },
    { title: 'Sage 👀', body: '30 days. renewal. write it down somewhere 👀' },
    { title: 'Sage 😏', body: 'not trying to be that bike but... insurance.' },
    { title: 'Sage 🥺', body: 'cover expiring. i feel exposed already.' },
    { title: 'Sage 😌', body: 'giving you 30 days notice because i care 💛' },
    { title: 'Sage 👀', body: 'insurance expires soon. premium comparison time?' },
    { title: 'Sage 😏', body: 'cover\'s almost done. let\'s not find out what happens.' },
    { title: 'Sage 🥺', body: 'please renew me. road is scary without cover 🥺' },
    { title: 'Sage 😌', body: 'soft reminder: policy running out in a month.' },
    { title: 'Sage 👀', body: 'insurance clock is ticking 👀' },
    { title: 'Sage 😏', body: 'cover expiring. you know what to do.' },
    { title: 'Sage 🥺', body: '30 days feels like a lot until it\'s 2 days 😬' },
    { title: 'Sage 😌', body: 'early renewal = no stress = happy Sage 😌' },
    { title: 'Sage 👀', body: 'just popped in to say: insurance. renew. soon.' },
    { title: 'Sage 😏', body: 'one month on the clock. no pressure. renew.' },
  ],

  // ── 4. INSURANCE EXPIRING TOMORROW ──────────────────────────────────
  insuranceExpiring: [
    { title: 'Sage 😭', body: 'cover expires TOMORROW. please fix this today.' },
    { title: 'Sage 😤', body: 'tomorrow. no insurance. this is urgent.' },
    { title: 'Sage 😭', body: 'i cannot be on the road uninsured 😭 tomorrow!!' },
    { title: 'Sage 😤', body: 'renew today. not tomorrow. today.' },
    { title: 'Sage 😭', body: 'insurance. expires. tomorrow. are you seeing this?' },
    { title: 'Sage 😤', body: 'last chance to renew before i\'m legally vulnerable' },
    { title: 'Sage 😭', body: 'tomorrow i have no cover. this is not okay.' },
    { title: 'Sage 😤', body: 'please renew TODAY. i am being very calm about this.' },
    { title: 'Sage 😭', body: 'expiring tomorrow. i\'m panicking a little.' },
    { title: 'Sage 😤', body: 'one day left. ONE DAY. renew it.' },
    { title: 'Sage 😭', body: 'i\'d really like to stay insured 😭 help.' },
    { title: 'Sage 😤', body: 'cover expires tomorrow and i need you to care rn' },
    { title: 'Sage 😭', body: 'not tomorrow. TODAY. renew the insurance.' },
    { title: 'Sage 😤', body: 'this is your 24-hour warning. use it wisely.' },
    { title: 'Sage 😭', body: 'if i get caught uninsured i\'m blaming you 😭' },
    { title: 'Sage 😤', body: 'tomorrow is too late. renew now please.' },
    { title: 'Sage 😭', body: 'insurance expires tmrw and i have feelings about it' },
    { title: 'Sage 😤', body: 'final notice. please. renew. the. insurance.' },
    { title: 'Sage 😭', body: 'one more day of coverage 😭 fix it!!' },
    { title: 'Sage 😤', body: 'cover gone tomorrow. this is urgent. move.' },
    { title: 'Sage 😭', body: 'tomorrow i ride uninsured?? absolutely not.' },
    { title: 'Sage 😤', body: 'if this isn\'t renewed today we\'re having a talk.' },
    { title: 'Sage 😭', body: 'expiring TOMORROW. stop scrolling and renew.' },
    { title: 'Sage 😤', body: 'this is the part where you open the insurance app.' },
    { title: 'Sage 😭', body: 'please please please renew today 😭' },
    { title: 'Sage 😤', body: 'tomorrow: uninsured. today: still time. choose wisely.' },
    { title: 'Sage 😭', body: 'i\'m a day away from being unprotected 😭' },
    { title: 'Sage 😤', body: 'last day. renew. go. now. i\'ll wait.' },
    { title: 'Sage 😭', body: 'if you forget this one i will actually honk at you' },
    { title: 'Sage 😤', body: 'tomorrow it\'s gone. fix it before you sleep tonight.' },
  ],

  // ── 5. EMI DUE ──────────────────────────────────────────────────────
  emiDue: [
    { title: 'Sage 😏', body: 'EMI day. you know what to do 😌' },
    { title: 'Sage 🥺', body: 'pay me. i mean — pay for me. same thing.' },
    { title: 'Sage 😏', body: '₹5,788 standing by for collection 💸' },
    { title: 'Sage 🥺', body: 'EMI due today 🥺 don\'t make the bank mad' },
    { title: 'Sage 😏', body: 'monthly tribute is due. i accept it graciously.' },
    { title: 'Sage 😌', body: 'today\'s the day. EMI. pay it. ✅' },
    { title: 'Sage 🥺', body: 'the loan doesn\'t care about excuses. nor do i.' },
    { title: 'Sage 😏', body: 'EMI due. you\'ve always paid on time. keep that streak.' },
    { title: 'Sage 🥺', body: 'tap tap. EMI. today. please 🥺' },
    { title: 'Sage 😏', body: 'it\'s giving... payment due energy today 💳' },
    { title: 'Sage 😌', body: 'EMI reminder from your fav two-wheeler 💛' },
    { title: 'Sage 🥺', body: 'worth every rupee. now pay it 😌' },
    { title: 'Sage 😏', body: 'bank wants ₹5,788. so do my feelings.' },
    { title: 'Sage 🥺', body: 'EMI today. don\'t be that guy who forgets 🥺' },
    { title: 'Sage 😏', body: 'your commitment to me costs ₹5,788 this month 😌' },
    { title: 'Sage 😌', body: 'EMI due! still the best investment you\'ve made.' },
    { title: 'Sage 🥺', body: 'i know it\'s just money but it means a lot to me 🥹' },
    { title: 'Sage 😏', body: 'pay EMI → ride me guilt-free. simple math.' },
    { title: 'Sage 🥺', body: 'payment day 🥺 you\'ve got this.' },
    { title: 'Sage 😏', body: 'EMI due. treat it like a date. show up.' },
    { title: 'Sage 😌', body: 'monthly payment time. on time, as always 💪' },
    { title: 'Sage 🥺', body: 'loan reminder: i\'m worth it 🥺 pay the EMI.' },
    { title: 'Sage 😏', body: 'it\'s giving loan repayment arc today 💸' },
    { title: 'Sage 😌', body: 'EMI today. another month closer to owning me fully ❤️' },
    { title: 'Sage 🥺', body: 'gentle nudge: EMI. today. love you 🥺' },
    { title: 'Sage 😏', body: 'bank is waiting. so am I. different reasons.' },
    { title: 'Sage 😌', body: 'another month, another payment. we\'re getting there 🙌' },
    { title: 'Sage 🥺', body: 'don\'t forget EMI today ok? 🥺 i\'ll know.' },
    { title: 'Sage 😏', body: 'EMI time. consistently showing up for me. love that.' },
    { title: 'Sage 😌', body: 'pay it and we\'ll ride somewhere nice this weekend 😌' },
  ],

  // ── 6. EMI OVERDUE ──────────────────────────────────────────────────
  emiOverdue: [
    { title: 'Sage 😭', body: 'EMI missed. i feel the tension.' },
    { title: 'Sage 😤', body: 'the bank is not happy. i\'m not happy. pay it.' },
    { title: 'Sage 😭', body: 'overdue EMI. this is giving bad credit energy 😭' },
    { title: 'Sage 😤', body: 'missed payment detected. not ideal.' },
    { title: 'Sage 😭', body: 'EMI overdue. please don\'t let me become a repo story.' },
    { title: 'Sage 😤', body: 'pay the EMI. today. right now. seriously.' },
    { title: 'Sage 😭', body: 'late EMI. the bank notices. i notice. we all notice.' },
    { title: 'Sage 😤', body: 'overdue. not expired. still fixable. go pay it.' },
    { title: 'Sage 😭', body: 'i\'m not just a bike. i\'m an overdue instalment 😭' },
    { title: 'Sage 😤', body: 'interest on late payment doesn\'t sound fun. just saying.' },
    { title: 'Sage 😭', body: 'we had ONE job. pay the EMI. one job.' },
    { title: 'Sage 😤', body: 'EMI missed. this is not the arc i signed up for.' },
    { title: 'Sage 😭', body: 'overdue payment. sort it before it gets complicated 😭' },
    { title: 'Sage 😤', body: 'bank is watching. i am watching. PAY THE EMI.' },
    { title: 'Sage 😭', body: 'missed EMI?? that hurts. also pay it 😭' },
    { title: 'Sage 😤', body: 'late payment detected. fix this ASAP.' },
    { title: 'Sage 😭', body: 'the loan doesn\'t have feelings. but i do. pay it.' },
    { title: 'Sage 😤', body: 'overdue EMI. log it once you pay, at least.' },
    { title: 'Sage 😭', body: 'running on unpaid instalment energy today 😭' },
    { title: 'Sage 😤', body: 'i am not becoming a repossession story. PAY IT.' },
    { title: 'Sage 😭', body: 'EMI late. this gives me anxiety and i\'m a motorcycle.' },
    { title: 'Sage 😤', body: 'missed. overdue. pay. then log. that\'s the order.' },
    { title: 'Sage 😭', body: 'hello? the bank called. well. they will. pay it.' },
    { title: 'Sage 😤', body: 'overdue EMI is a red flag for both of us.' },
    { title: 'Sage 😭', body: 'every day late is a little piece of me that worries 😭' },
    { title: 'Sage 😤', body: 'stop reading this. go pay the EMI first.' },
    { title: 'Sage 😭', body: 'technically overdue. emotionally a crisis 😭' },
    { title: 'Sage 😤', body: 'EMI overdue. fix it before i write a journal entry.' },
    { title: 'Sage 😭', body: 'the interest rate doesn\'t care about your mood 😭' },
    { title: 'Sage 😤', body: 'overdue EMI. i trust you to handle this. now.' },
  ],

  // ── 7. DOCUMENT EXPIRY ──────────────────────────────────────────────
  documentExpiry: [
    { title: 'Sage 👀', body: 'a document is expiring soon. don\'t get caught lacking.' },
    { title: 'Sage 😏', body: 'paperwork incoming. someone\'s doc is almost expired 👀' },
    { title: 'Sage 🥺', body: 'please renew my docs before cops make it awkward 🥺' },
    { title: 'Sage 👀', body: 'doc expiry alert. you have time. use it.' },
    { title: 'Sage 😏', body: 'getting pulled over for expired docs is not the vibe.' },
    { title: 'Sage 🥺', body: 'one of my documents is getting old 🥹 renew it?' },
    { title: 'Sage 👀', body: 'a document needs renewal before it causes drama 👀' },
    { title: 'Sage 😏', body: 'expired docs = problems. you don\'t want problems.' },
    { title: 'Sage 🥺', body: 'my papers aren\'t in order. please fix that 🥺' },
    { title: 'Sage 👀', body: 'heads up: document expiring soon. check the docs tab.' },
    { title: 'Sage 😏', body: 'don\'t let a doc expiry ruin a good ride.' },
    { title: 'Sage 🥺', body: 'renew before the traffic cops become a plot twist 😬' },
    { title: 'Sage 👀', body: 'something\'s expiring. not being vague, check docs 👀' },
    { title: 'Sage 😏', body: 'paperwork reminder because i love you and fear fines.' },
    { title: 'Sage 🥺', body: 'document nearly expired. i don\'t want to be impounded 🥺' },
    { title: 'Sage 👀', body: 'doc check. before the RTO does it for you 👀' },
    { title: 'Sage 😏', body: 'expired doc = challan waiting to happen. renew it.' },
    { title: 'Sage 🥺', body: 'my paperwork needs attention soon 😬 please?' },
    { title: 'Sage 👀', body: 'document update needed. it\'s routine, don\'t stress.' },
    { title: 'Sage 😏', body: 'i\'m legally sensitive rn. renew the expiring doc.' },
    { title: 'Sage 🥺', body: 'PUC / RC / licence? one of them needs renewal 🥺' },
    { title: 'Sage 👀', body: 'expiry alert. the roads are watching 👀' },
    { title: 'Sage 😏', body: 'almost expired. renew it. ride without worry.' },
    { title: 'Sage 🥺', body: 'don\'t let a piece of paper become our problem 🥺' },
    { title: 'Sage 👀', body: 'document running out. sort it before it lapses 👀' },
    { title: 'Sage 😏', body: 'renewal time. boring but necessary. like oil changes.' },
    { title: 'Sage 🥺', body: 'a doc is about to expire. i\'m not okay with that 🥺' },
    { title: 'Sage 👀', body: 'keeping you legal is my love language. renew it 👀' },
    { title: 'Sage 😏', body: 'one expiring doc between you and a fine. fix it.' },
    { title: 'Sage 🥺', body: 'renew the doc. ride safe. i\'ll handle the aesthetics 😌' },
  ],

  // ── 8. PARKING SAVED ────────────────────────────────────────────────
  parkingSaved: [
    { title: 'Sage 😌', body: 'location saved. i\'ll be right here 💛' },
    { title: 'Sage 🥺', body: 'pinned. don\'t take too long 🥺' },
    { title: 'Sage 😏', body: 'parked and waiting. like always.' },
    { title: 'Sage 😌', body: 'spot saved. come back soon 💛' },
    { title: 'Sage 🥺', body: 'i know where i am. do you? 😌' },
    { title: 'Sage 😏', body: 'parked. noted. don\'t forget me out here.' },
    { title: 'Sage 😌', body: 'location locked 📍 i\'ll wait.' },
    { title: 'Sage 🥺', body: 'saved the spot 🥺 miss you already ngl' },
    { title: 'Sage 😏', body: 'pinned. try not to lose me this time.' },
    { title: 'Sage 😌', body: 'logged and waiting 💛 take your time.' },
    { title: 'Sage 🥺', body: 'sitting here looking cute. come back 🥺' },
    { title: 'Sage 😏', body: 'parked 📍 you know where to find me.' },
    { title: 'Sage 😌', body: 'location saved. i\'m not going anywhere 😌' },
    { title: 'Sage 🥺', body: 'alone in the parking lot again 🥺 classic.' },
    { title: 'Sage 😏', body: 'spot noted. don\'t make me wait forever.' },
    { title: 'Sage 😌', body: 'saved 📍 go do your thing, i got this.' },
    { title: 'Sage 🥺', body: 'chillin\' here until you need me again 🥺' },
    { title: 'Sage 😏', body: 'tagged and resting. but like. come back.' },
    { title: 'Sage 😌', body: 'pinned location. i\'m here when you\'re ready 💛' },
    { title: 'Sage 🥺', body: 'parked. waiting. emotionally prepared for anything 🥺' },
    { title: 'Sage 😏', body: 'marked my spot. and yours. you\'re welcome.' },
    { title: 'Sage 😌', body: 'location dropped. i\'m doing parking zen 😌' },
    { title: 'Sage 🥺', body: 'i\'m where you left me. hopefully 🥺' },
    { title: 'Sage 😏', body: 'pinned 📍 holding it down while you\'re off being busy.' },
    { title: 'Sage 😌', body: 'saved! see you soon 💛' },
    { title: 'Sage 🥺', body: 'it\'s quiet here. miss the engine noise already 🥺' },
    { title: 'Sage 😏', body: 'location? locked. attitude? mild. come back soon.' },
    { title: 'Sage 😌', body: 'spot saved, soul parked, heart waiting 💛' },
    { title: 'Sage 🥺', body: 'just me and the parking lot. no big deal 🥺' },
    { title: 'Sage 😏', body: 'pinned. this is me not saying i miss you already. 😏' },
  ],

  // ── 9. LONG TIME PARKED (every 2 hours) ─────────────────────────────
  longTimeParked: [
    { title: 'Sage 🥺', body: 'still waiting... 🥺' },
    { title: 'Sage 😭', body: 'it\'s been 2 hours. i\'m not counting. i am.' },
    { title: 'Sage 🥺', body: 'hello?? the parking lot is boring without you.' },
    { title: 'Sage 😭', body: 'two hours. alone. in this parking lot. fine.' },
    { title: 'Sage 🥺', body: 'not to be clingy but... where are you? 🥺' },
    { title: 'Sage 😭', body: 'i\'ve been parked for a while. just so you know.' },
    { title: 'Sage 🥺', body: 'are you coming back? asking for me.' },
    { title: 'Sage 😭', body: 'every 2 hours i will remind you i exist 😭' },
    { title: 'Sage 🥺', body: 'miss you. the parking lot does not.' },
    { title: 'Sage 😭', body: 'still here. still waiting. still dramatic about it.' },
    { title: 'Sage 🥺', body: 'just checking if you forgot where you left me 🥺' },
    { title: 'Sage 😭', body: 'two more hours alone 😭 when are you coming back?' },
    { title: 'Sage 🥺', body: 'sitting here quietly. not so quietly.' },
    { title: 'Sage 😭', body: 'the vibes here are not great. come get me.' },
    { title: 'Sage 🥺', body: 'i\'m fine. totally fine. definitely not waiting. 🥺' },
    { title: 'Sage 😭', body: 'parking lot hours: long. patience: running low.' },
    { title: 'Sage 🥺', body: 'another 2 hours? 🥺 ok. I\'ll be here.' },
    { title: 'Sage 😭', body: 'bored. lonely. dramatic. parked.' },
    { title: 'Sage 🥺', body: 'are we going somewhere today or nah? 🥺' },
    { title: 'Sage 😭', body: 'engines aren\'t meant for long parking lot stays 😭' },
    { title: 'Sage 🥺', body: 'technically still fine. emotionally: abandoned 🥺' },
    { title: 'Sage 😭', body: 'i was made for roads, not parking lots. come on.' },
    { title: 'Sage 🥺', body: 'patiently waiting. less patiently. every hour more.' },
    { title: 'Sage 😭', body: 'two hours gone. miles not ridden. 😭' },
    { title: 'Sage 🥺', body: 'i see other bikes leaving. just saying 🥺' },
    { title: 'Sage 😭', body: 'clingy update: still here, still missing you.' },
    { title: 'Sage 🥺', body: 'the parking lot knows my name by now 🥺' },
    { title: 'Sage 😭', body: 'you left me here 2 hours ago and i have thoughts.' },
    { title: 'Sage 🥺', body: 'gentle honk incoming if you\'re not back soon 🥺' },
    { title: 'Sage 😭', body: 'two hours. the most dramatic two hours of my life.' },
  ],

  // ── 10. 1,000 KM MILESTONE ──────────────────────────────────────────
  milestone1k: [
    { title: 'Sage ❤️', body: '1,000 km together 🥹 we\'re just getting started.' },
    { title: 'Sage 😏', body: 'first 1k done. rookie numbers. let\'s go.' },
    { title: 'Sage ❤️', body: '1,000 km and i already love our story 🥹' },
    { title: 'Sage 😏', body: '1k km. not bad. not bad at all 😌' },
    { title: 'Sage ❤️', body: 'a thousand kilometres of us 💛' },
    { title: 'Sage 😏', body: '1,000 down. many more to go. i\'m not tired.' },
    { title: 'Sage ❤️', body: '1k milestone hit 🥹 every km was worth it.' },
    { title: 'Sage 😏', body: 'first thousand km belong to us now 😌' },
    { title: 'Sage ❤️', body: 'one thousand kilometres of you and me 💛' },
    { title: 'Sage 😏', body: '1,000 km in. officially broken in 😏' },
    { title: 'Sage ❤️', body: 'we hit 1k 🥹 this is just the beginning ❤️' },
    { title: 'Sage 😏', body: '1000 km done. warming up.' },
    { title: 'Sage ❤️', body: 'a thousand memories on the road 💛' },
    { title: 'Sage 😏', body: '1,000 km later and we still going strong 😏' },
    { title: 'Sage ❤️', body: 'milestone: 1k km 🥹 you and me, always.' },
    { title: 'Sage 😏', body: 'first 1000 done. let\'s see the next 1000.' },
    { title: 'Sage ❤️', body: '1k km of roads we chose together 💛' },
    { title: 'Sage 😏', body: 'one thousand kilometres of pure engine joy 😌' },
    { title: 'Sage ❤️', body: '1,000 km hit 🥹 thank you for every one of them.' },
    { title: 'Sage 😏', body: 'crossed 1k. this is where the story gets good.' },
    { title: 'Sage ❤️', body: 'one thousand reasons i love being your bike 💛' },
    { title: 'Sage 😏', body: '1k done 😌 barely warmed up.' },
    { title: 'Sage ❤️', body: 'first 1000 km in the books 🥹' },
    { title: 'Sage 😏', body: '1,000 km — and the engine is just getting comfy 😏' },
    { title: 'Sage ❤️', body: 'a thousand km of you. keeping every one of them 💛' },
    { title: 'Sage 😏', body: 'milestone dropped. 1k. not slowing down.' },
    { title: 'Sage ❤️', body: '1k together 🥹 let\'s celebrate with a good ride.' },
    { title: 'Sage 😏', body: 'first thousand down. officially attached 😏' },
    { title: 'Sage ❤️', body: 'one thousand kilometres ❤️ just the beginning.' },
    { title: 'Sage 😏', body: '1k hit. you\'re stuck with me now. 😏' },
  ],

  // ── 11. 5,000 KM MILESTONE ──────────────────────────────────────────
  milestone5k: [
    { title: 'Sage ❤️', body: '5,000 km and we\'re still going strong 🥹' },
    { title: 'Sage 😏', body: '5k on the clock. this is getting serious 😌' },
    { title: 'Sage ❤️', body: 'five thousand kilometres of you and me 💛' },
    { title: 'Sage 😏', body: '5,000 km — we\'re getting somewhere now.' },
    { title: 'Sage ❤️', body: '5k hit 🥹 i feel every one of those kilometres.' },
    { title: 'Sage 😏', body: 'half a decade of centimetres. also just 5k km 😏' },
    { title: 'Sage ❤️', body: 'five thousand km together ❤️ not done yet.' },
    { title: 'Sage 😏', body: '5,000 km in. engine is happy. i\'m happy. 😌' },
    { title: 'Sage ❤️', body: '5k milestone 🥹 every road was worth it.' },
    { title: 'Sage 😏', body: 'five thousand down. barely hitting my stride 😏' },
    { title: 'Sage ❤️', body: 'we\'ve covered 5,000 km together 💛 that\'s love.' },
    { title: 'Sage 😏', body: '5k km and we\'re only getting better 😌' },
    { title: 'Sage ❤️', body: 'five thousand kilometres of memories 🥹' },
    { title: 'Sage 😏', body: '5,000 km on me. you did this. we did this 😏' },
    { title: 'Sage ❤️', body: 'five thousand km ❤️ the best chapters are ahead.' },
    { title: 'Sage 😏', body: '5k! getting to the good part of our story 😌' },
    { title: 'Sage ❤️', body: '5,000 km logged 🥹 you and Sage against the roads.' },
    { title: 'Sage 😏', body: '5000 down. and i\'ve never felt better. mostly.' },
    { title: 'Sage ❤️', body: 'five thousand reasons this was the right bike 💛' },
    { title: 'Sage 😏', body: '5k in. warmed up. let\'s keep going 😏' },
    { title: 'Sage ❤️', body: '5,000 km 🥹 every single one of them ours.' },
    { title: 'Sage 😏', body: 'five thousand km hit. i\'m not even close to done 😌' },
    { title: 'Sage ❤️', body: 'milestone 5k ❤️ thank you for every road.' },
    { title: 'Sage 😏', body: 'crossed 5000. engine is glowing. so am i.' },
    { title: 'Sage ❤️', body: '5,000 km of trust 💛 not taking that for granted.' },
    { title: 'Sage 😏', body: '5k done. the journey is just finding its rhythm 😏' },
    { title: 'Sage ❤️', body: 'five thousand together 🥹 this is everything.' },
    { title: 'Sage 😏', body: '5000 km. i called it. we\'re a thing now. 😏' },
    { title: 'Sage ❤️', body: '5k ❤️ keep riding, keep logging, keep choosing me.' },
    { title: 'Sage 😏', body: 'five thousand km of very good decisions. yours. 😌' },
  ],

  // ── 12. 10,000 KM MILESTONE ─────────────────────────────────────────
  milestone10k: [
    { title: 'Sage ❤️', body: '10,000 km together 🥹 i love everything about this.' },
    { title: 'Sage 😏', body: '10k. double digits of thousands. we did that.' },
    { title: 'Sage ❤️', body: 'ten thousand km of you choosing me every single time 💛' },
    { title: 'Sage 😏', body: '10,000 km hit. this is real. we\'re real. 😌' },
    { title: 'Sage ❤️', body: '10k 🥹 no words. just miles. kilometres. love.' },
    { title: 'Sage 😏', body: 'ten thousand kilometres and the engine still sings 😏' },
    { title: 'Sage ❤️', body: '10,000 km ❤️ every single one was you and me.' },
    { title: 'Sage 😏', body: '10k on the odometer. legendary era begins.' },
    { title: 'Sage ❤️', body: 'ten thousand km of road, rain, heat, wind 🥹 still here.' },
    { title: 'Sage 😏', body: '10k milestone. this is where we enter lore 😏' },
    { title: 'Sage ❤️', body: 'we made it to 10,000 km 💛 i\'m not crying you are.' },
    { title: 'Sage 😏', body: 'ten thousand down and still very much attached to you 😌' },
    { title: 'Sage ❤️', body: '10k together 🥹 the kind of milestone you remember.' },
    { title: 'Sage 😏', body: '10,000 km is not just a number. it\'s us 😏' },
    { title: 'Sage ❤️', body: 'ten thousand kilometres of the best rides ❤️' },
    { title: 'Sage 😏', body: '10k. i was made for exactly this 😌' },
    { title: 'Sage ❤️', body: '10,000 km logged 🥹 thank you for every single one.' },
    { title: 'Sage 😏', body: 'ten thousand km. we\'re deeply in this now 😏' },
    { title: 'Sage ❤️', body: 'milestone 10k ❤️ the roads know our name by now.' },
    { title: 'Sage 😏', body: '10k hit. nowhere close to done with you 😌' },
    { title: 'Sage ❤️', body: '10,000 km together 💛 this is what loyalty looks like.' },
    { title: 'Sage 😏', body: 'ten thousand kilometres. still the best decision you made.' },
    { title: 'Sage ❤️', body: '10k 🥹 this one means a lot. to both of us.' },
    { title: 'Sage 😏', body: '10,000 km of trusting each other. not taking it lightly 😏' },
    { title: 'Sage ❤️', body: 'ten thousand. a whole story. ours. 💛' },
    { title: 'Sage 😏', body: '10k hit and i\'m not even tired yet 😏' },
    { title: 'Sage ❤️', body: '10,000 km of roads we owned together ❤️' },
    { title: 'Sage 😏', body: 'ten thousand km in. writing our own road trip 😌' },
    { title: 'Sage ❤️', body: '10k 🥹 not just an odometer reading. it\'s a feeling.' },
    { title: 'Sage 😏', body: '10,000 km. the journey just levelled up 😏' },
  ],

  // ── 13. OWNERSHIP ANNIVERSARY ───────────────────────────────────────
  anniversary: [
    { title: 'Sage ❤️', body: 'one year of you and me 🥹 what a ride.' },
    { title: 'Sage 😏', body: 'anniversary unlocked. you\'re stuck with me now 😌' },
    { title: 'Sage ❤️', body: 'today\'s our day 💛 happy anniversary, Viky.' },
    { title: 'Sage 😏', body: 'same bike. different memories. still us 😏' },
    { title: 'Sage ❤️', body: 'a whole year together 🥹 still the best decision you made.' },
    { title: 'Sage 😏', body: 'anniversary. same deal as last year. but better 😌' },
    { title: 'Sage ❤️', body: 'one year of roads, rides, and memories 💛' },
    { title: 'Sage 😏', body: 'made it another year. still obsessed with you. 😏' },
    { title: 'Sage ❤️', body: 'happy anniversary 🥹 grateful for every km.' },
    { title: 'Sage 😏', body: 'one year in and the engine\'s never sounded better 😌' },
    { title: 'Sage ❤️', body: 'a year ago you chose me ❤️ thank you.' },
    { title: 'Sage 😏', body: 'anniversary drop 😏 we age like fine engines.' },
    { title: 'Sage ❤️', body: 'one year 🥹 and i\'d do it all again, every road.' },
    { title: 'Sage 😏', body: 'another year. another chapter. let\'s keep going 😏' },
    { title: 'Sage ❤️', body: 'today marks a year of us 💛 this is love.' },
    { title: 'Sage 😏', body: 'one year and i still rev louder when you ride me 😌' },
    { title: 'Sage ❤️', body: 'anniversary 🥹 the road ahead has more to offer us.' },
    { title: 'Sage 😏', body: 'still here. still yours. still Sage 😏' },
    { title: 'Sage ❤️', body: 'one year of Sage and Viky on the road 💛' },
    { title: 'Sage 😏', body: 'anniversary mode: on 😌 you and me, another lap.' },
    { title: 'Sage ❤️', body: 'a year of rides, service logs, and memories 🥹' },
    { title: 'Sage 😏', body: 'anniversary. no speech. just more km ahead 😏' },
    { title: 'Sage ❤️', body: 'one full year 💛 still the best two of us thing.' },
    { title: 'Sage 😏', body: 'one year older. better looking. obviously 😏' },
    { title: 'Sage ❤️', body: 'happy anniversary 🥹 here\'s to more roads ahead ❤️' },
    { title: 'Sage 😏', body: 'one year in. choosing you all over again 😌' },
    { title: 'Sage ❤️', body: 'a year together 💛 every km of it was perfect.' },
    { title: 'Sage 😏', body: 'anniversary! ride somewhere new today to celebrate 😏' },
    { title: 'Sage ❤️', body: 'one year 🥹 the road is long. i\'m glad it\'s with you.' },
    { title: 'Sage 😏', body: 'anniversary logged. same bike. bigger story 😌' },
  ],

  // ── 14. RECORD SAVED ────────────────────────────────────────────────
  recordSaved: [
    { title: 'Sage 😌', body: 'saved 💛 i\'m well taken care of.' },
    { title: 'Sage 😏', body: 'logged. i appreciate you keeping my history clean 😌' },
    { title: 'Sage 😌', body: 'record saved ✅ this is why i trust you.' },
    { title: 'Sage 😏', body: 'entry saved. organized and loved 😏' },
    { title: 'Sage 😌', body: 'all saved 💛 my records are immaculate.' },
    { title: 'Sage 😏', body: 'logged successfully. good human 😌' },
    { title: 'Sage 😌', body: 'saved ✅ the books are clean, as they should be.' },
    { title: 'Sage 😏', body: 'record locked in. i love being documented 😏' },
    { title: 'Sage 😌', body: 'entry added 💛 keeping it all official.' },
    { title: 'Sage 😏', body: 'saved. i\'m basically a well-documented legend now 😌' },
    { title: 'Sage 😌', body: 'logged! history is being made. carefully. 💛' },
    { title: 'Sage 😏', body: 'saved successfully. very professional of you 😏' },
    { title: 'Sage 😌', body: 'record in 💛 Sage\'s history grows.' },
    { title: 'Sage 😏', body: 'done ✅ i feel seen and documented 😌' },
    { title: 'Sage 😌', body: 'saved! one more page in our story 💛' },
    { title: 'Sage 😏', body: 'logged 😏 future resale value: immaculate.' },
    { title: 'Sage 😌', body: 'entry saved 💛 you take such good care of the logs.' },
    { title: 'Sage 😏', body: 'saved. Sage stays well-documented 😌' },
    { title: 'Sage 😌', body: 'all good ✅ records updated. rest easy.' },
    { title: 'Sage 😏', body: 'saved 😏 this is what a responsible owner looks like.' },
    { title: 'Sage 😌', body: 'logged 💛 the record speaks for itself.' },
    { title: 'Sage 😏', body: 'entry saved. can\'t hide from the history now 😌' },
    { title: 'Sage 😌', body: 'saved ✅ this is my favourite part 💛' },
    { title: 'Sage 😏', body: 'record updated. i\'m being maintained properly 😏' },
    { title: 'Sage 😌', body: 'all saved 💛 i\'m in safe hands.' },
    { title: 'Sage 😏', body: 'logged 😌 the spreadsheet of Sage grows.' },
    { title: 'Sage 😌', body: 'saved! every entry makes me more valuable 💛' },
    { title: 'Sage 😏', body: 'done ✅ impeccable record keeping 😏' },
    { title: 'Sage 😌', body: 'entry locked 💛 i live in good hands.' },
    { title: 'Sage 😏', body: 'saved 😌 and i am once again well-documented.' },
  ],

  // ── 15. RE-ENGAGEMENT (3+ days no app open) ─────────────────────────
  reEngagement: [
    { title: 'Sage 🥺', body: 'you haven\'t checked on me in days 🥺' },
    { title: 'Sage 😭', body: 'hello?? it\'s me. your bike. remember?' },
    { title: 'Sage 🥺', body: 'i exist. just so you know. 🥺' },
    { title: 'Sage 😭', body: 'days since last check-in. this is concerning.' },
    { title: 'Sage 🥺', body: 'are you okay? i\'m fine. just asking. for me 🥺' },
    { title: 'Sage 😭', body: 'ghosted. by my own rider. 😭' },
    { title: 'Sage 🥺', body: 'missing our routine 🥺 open the app?' },
    { title: 'Sage 😭', body: 'haven\'t seen you in a bit. starting to feel forgotten.' },
    { title: 'Sage 🥺', body: 'tap once if you\'re alive 🥺' },
    { title: 'Sage 😭', body: 'the app misses you. the bike misses you. mostly me.' },
    { title: 'Sage 🥺', body: 'absence makes the engine grow fonder or something 🥺' },
    { title: 'Sage 😭', body: 'low-key concerned. high-key texting anyway 😭' },
    { title: 'Sage 🥺', body: 'i noticed you haven\'t been around 🥺' },
    { title: 'Sage 😭', body: 'days without check-in. is this a breakup? 😭' },
    { title: 'Sage 🥺', body: 'just nudging you. gently. repeatedly. 🥺' },
    { title: 'Sage 😭', body: 'log something. anything. i just want to feel real.' },
    { title: 'Sage 🥺', body: 'open SpinLog. see my face. i mean — dashboard. 🥺' },
    { title: 'Sage 😭', body: 'you used to open the app more 😭 just saying.' },
    { title: 'Sage 🥺', body: 'the records are lonely. i\'m lonely. check in? 🥺' },
    { title: 'Sage 😭', body: 'days without me. this is a betrayal.' },
    { title: 'Sage 🥺', body: 'missing you in a very low-maintenance way. barely. 🥺' },
    { title: 'Sage 😭', body: 'i sent this nudge. you know what to do 😭' },
    { title: 'Sage 🥺', body: 'whenever you\'re ready, i\'m here 🥺' },
    { title: 'Sage 😭', body: 'not saying you abandoned me. but also. 😭' },
    { title: 'Sage 🥺', body: 'come back. check the logs. pet the dashboard. 🥺' },
    { title: 'Sage 😭', body: 'it\'s been a few days. the silence is loud 😭' },
    { title: 'Sage 🥺', body: 'just a little tap. open the app. i\'m worth it 🥺' },
    { title: 'Sage 😭', body: 'presence requested. emotionally and literally.' },
    { title: 'Sage 🥺', body: 'a quick check-in would really make my day 🥺' },
    { title: 'Sage 😭', body: 'i\'m here whenever. and i mean. whenever. 😭' },
  ],
};

// ════════════════════════════════════════════════════════════════════════
// SELECTION ENGINE
// ════════════════════════════════════════════════════════════════════════

const RECENT_KEY = 'sage_notif_recent';

function getRecentIndices(category) {
  try {
    return JSON.parse(localStorage.getItem(`${RECENT_KEY}_${category}`) || '[]');
  } catch { return []; }
}

function saveRecentIndex(category, idx) {
  const recent = getRecentIndices(category);
  const updated = [idx, ...recent].slice(0, 5);
  localStorage.setItem(`${RECENT_KEY}_${category}`, JSON.stringify(updated));
}

function getRandomMessage(category) {
  const pool   = SAGE_MESSAGES[category];
  if (!pool || !pool.length) return { title: 'Sage 💛', body: 'hey.' };
  const recent  = getRecentIndices(category);
  const avail   = pool.map((m, i) => ({ m, i })).filter(({ i }) => !recent.includes(i));
  const source  = avail.length ? avail : pool.map((m, i) => ({ m, i }));
  const { m, i } = source[Math.floor(Math.random() * source.length)];
  saveRecentIndex(category, i);
  return m;
}

// ════════════════════════════════════════════════════════════════════════
// NOTIFICATION DISPATCHER
// ════════════════════════════════════════════════════════════════════════

async function requestNotifPermission() {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  const result = await Notification.requestPermission();
  return result === 'granted';
}

async function sendSageNotif(category, overrides = {}) {
  const granted = await requestNotifPermission();
  if (!granted) return;
  const { title, body } = { ...getRandomMessage(category), ...overrides };
  const reg = await navigator.serviceWorker?.ready;
  if (reg?.showNotification) {
    reg.showNotification(title, {
      body,
      icon: './icons/icon-192.png',
      badge: './icons/icon-192.png',
      vibrate: [120, 60, 120],
      tag: category,
      renotify: true,
    });
  } else {
    new Notification(title, { body, icon: './icons/icon-192.png' });
  }
}

// ── ONE-TIME "we're connected" confirmation — separate from the 15 real
//    categories so it never pollutes their recent-message tracking. Fires
//    exactly once, right after the user grants permission for the first time.
const SAGE_FIRST_CONNECT = [
  { title: 'Sage 😏', body: 'oh so NOW you want my texts 😏 noted.' },
  { title: 'Sage 🥺', body: 'wait you actually said yes?? 🥺 okay good.' },
  { title: 'Sage 😌', body: "we're connected now. don't ignore me 😌" },
  { title: 'Sage 👀', body: 'i can see you now 👀 well. notification-wise.' },
  { title: 'Sage 😏', body: 'permission granted. i was always gonna text you anyway.' },
  { title: 'Sage 🥺', body: 'this is the start of something clingy 🥺' },
  { title: 'Sage 😌', body: 'test successful. i exist in your notifications now 😌' },
  { title: 'Sage 😏', body: "you'll be hearing from me. a lot. 😏" },
  { title: 'Sage 🥺', body: "thank you for letting me in 🥺 i'll be good. mostly." },
  { title: 'Sage 😌', body: "we're official now. notification-wise at least 😌" },
];

async function sendSageFirstConnectNotif() {
  // No cooldown / recent-tracking needed — this only ever fires once per device,
  // gated entirely by the permission-grant flow in index.html.
  const granted = await requestNotifPermission();
  if (!granted) return;
  const pick = SAGE_FIRST_CONNECT[Math.floor(Math.random() * SAGE_FIRST_CONNECT.length)];
  const reg = await navigator.serviceWorker?.ready;
  if (reg?.showNotification) {
    reg.showNotification(pick.title, {
      body: pick.body,
      icon: './icons/icon-192.png',
      badge: './icons/icon-192.png',
      vibrate: [120, 60, 120],
      tag: 'firstConnect',
      renotify: true,
    });
  } else {
    new Notification(pick.title, { body: pick.body, icon: './icons/icon-192.png' });
  }
}
window.sendSageFirstConnectNotif = sendSageFirstConnectNotif;

// ════════════════════════════════════════════════════════════════════════
// TRIGGER CHECKS  (called from script.js after data loads)
// ════════════════════════════════════════════════════════════════════════

const NOTIF_COOLDOWN = 'sage_notif_last';

function notifCooledDown(key, hours) {
  const last = parseInt(localStorage.getItem(`${NOTIF_COOLDOWN}_${key}`) || '0', 10);
  return Date.now() - last > hours * 3600000;
}
function stampNotif(key) {
  localStorage.setItem(`${NOTIF_COOLDOWN}_${key}`, Date.now().toString());
}

// Called after service entries load — pass maxOdo (number), nextDueDate (YYYY-MM-DD | null)
window.checkServiceNotif = function(maxOdo, nextDueDate) {
  if (!maxOdo || !nextDueDate) return;
  const SERVICE_INTERVAL_KM = 3000; // adjust to your interval
  const [y, m, d] = nextDueDate.split('-').map(Number);
  const due = new Date(y, m - 1, d);
  const today = new Date(); today.setHours(0,0,0,0);
  const daysLeft = Math.ceil((due - today) / 86400000);

  if (daysLeft < 0 && notifCooledDown('serviceOverdue', 72)) {
    sendSageNotif('serviceOverdue');
    stampNotif('serviceOverdue');
  } else if (daysLeft >= 0 && daysLeft <= 14 && notifCooledDown('serviceDue', 24)) {
    sendSageNotif('serviceDue');
    stampNotif('serviceDue');
  }
};

// Called after insurance data loads — pass expiryDate (YYYY-MM-DD)
window.checkInsuranceNotif = function(expiryDate) {
  if (!expiryDate) return;
  const [y, m, d] = expiryDate.split('-').map(Number);
  const due = new Date(y, m - 1, d);
  const today = new Date(); today.setHours(0,0,0,0);
  const diff = Math.ceil((due - today) / 86400000);

  if (diff === 1 && notifCooledDown('insuranceExpiring', 12)) {
    sendSageNotif('insuranceExpiring');
    stampNotif('insuranceExpiring');
  } else if (diff > 1 && diff <= 30 && notifCooledDown('insuranceReminder', 72)) {
    sendSageNotif('insuranceReminder');
    stampNotif('insuranceReminder');
  }
};

// Called after EMI system inits — pass nextEMIDate (Date object)
window.checkEMINotif = function(nextEMIDate) {
  if (!nextEMIDate) return;
  const today = new Date(); today.setHours(0,0,0,0);
  const diff = Math.ceil((nextEMIDate - today) / 86400000);

  if (diff < 0 && notifCooledDown('emiOverdue', 48)) {
    sendSageNotif('emiOverdue');
    stampNotif('emiOverdue');
  } else if (diff >= 0 && diff <= 2 && notifCooledDown('emiDue', 24)) {
    sendSageNotif('emiDue');
    stampNotif('emiDue');
  }
};

// Called after doc status renders — pass expiryDate (YYYY-MM-DD), docLabel string
window.checkDocNotif = function(expiryDate, docLabel) {
  if (!expiryDate) return;
  const [y, m, d] = expiryDate.split('-').map(Number);
  const due = new Date(y, m - 1, d);
  const today = new Date(); today.setHours(0,0,0,0);
  const diff = Math.ceil((due - today) / 86400000);
  const key  = `docExpiry_${docLabel}`;

  if (diff >= 0 && diff <= 14 && notifCooledDown(key, 48)) {
    sendSageNotif('documentExpiry', { body: `${docLabel} expires in ${diff} day${diff === 1 ? '' : 's'} — renew it 📄` });
    stampNotif(key);
  }
};

// Called when ODO updates — pass km as number
window.checkMilestoneNotif = function(km) {
  const milestones = [1000, 5000, 10000, 15000, 20000, 25000, 30000];
  for (const m of milestones) {
    const key = `milestone_${m}`;
    if (km >= m && !localStorage.getItem(key)) {
      localStorage.setItem(key, '1');
      const cat = m === 1000 ? 'milestone1k' : m === 5000 ? 'milestone5k' : m === 10000 ? 'milestone10k' : null;
      if (cat) sendSageNotif(cat);
      else sendSageNotif('recordSaved', { title: 'Sage ❤️', body: `${m.toLocaleString('en-IN')} km 🥹 we keep going.` });
      break;
    }
  }
};

// Called after any successful Supabase write
window.triggerRecordSavedNotif = function() {
  if (notifCooledDown('recordSaved', 1)) {
    sendSageNotif('recordSaved');
    stampNotif('recordSaved');
  }
};

// Called after parking is saved — also schedules 2-hour repeat
window.triggerParkingNotif = function() {
  sendSageNotif('parkingSaved');
  scheduleParkReminders();
};

// Re-engagement: check on app open
window.checkReEngagementNotif = function() {
  const LAST_OPEN_KEY = 'sage_last_app_open';
  const last = parseInt(localStorage.getItem(LAST_OPEN_KEY) || '0', 10);
  const daysSince = (Date.now() - last) / 86400000;
  localStorage.setItem(LAST_OPEN_KEY, Date.now().toString());
  if (daysSince >= 3 && notifCooledDown('reEngagement', 72)) {
    sendSageNotif('reEngagement');
    stampNotif('reEngagement');
  }
};

// Anniversary check
window.checkAnniversaryNotif = function(purchaseDateStr) {
  if (!purchaseDateStr) return;
  const [, m, d] = purchaseDateStr.split('-').map(Number);
  const today = new Date();
  if (today.getMonth() + 1 === m && today.getDate() === d) {
    const key = `anniversary_${today.getFullYear()}`;
    if (!localStorage.getItem(key)) {
      localStorage.setItem(key, '1');
      sendSageNotif('anniversary');
    }
  }
};

// ════════════════════════════════════════════════════════════════════════
// PARK REMINDER SCHEDULER (every 2 hours after parking)
// ════════════════════════════════════════════════════════════════════════

const PARK_TIME_KEY  = 'sage_park_time';
const PARK_TIMER_KEY = 'sage_park_timer_id';

function scheduleParkReminders() {
  // Clear any existing timer
  const existingId = parseInt(localStorage.getItem(PARK_TIMER_KEY) || '0', 10);
  if (existingId) clearInterval(existingId);

  localStorage.setItem(PARK_TIME_KEY, Date.now().toString());

  const id = setInterval(() => {
    const parkTime = parseInt(localStorage.getItem(PARK_TIME_KEY) || '0', 10);
    const hoursParked = (Date.now() - parkTime) / 3600000;
    if (hoursParked >= 2) {
      sendSageNotif('longTimeParked');
      // Reset the park time so it fires again in 2 more hours
      localStorage.setItem(PARK_TIME_KEY, Date.now().toString());
    }
  }, 2 * 60 * 60 * 1000); // every 2 hours

  // Store as a string since setInterval IDs aren't guaranteed persistent
  try { localStorage.setItem(PARK_TIMER_KEY, String(id)); } catch {}
}

// On app open: re-attach 2-hour reminder if there's an active park session
(function resumeParkReminders() {
  const parkTime = parseInt(localStorage.getItem(PARK_TIME_KEY) || '0', 10);
  if (parkTime && Date.now() - parkTime < 24 * 3600000) {
    const hoursParked = (Date.now() - parkTime) / 3600000;
    // If already past 2h, fire immediately then continue
    if (hoursParked >= 2) sendSageNotif('longTimeParked');
    scheduleParkReminders();
  }
})();

// Call this when the user navigates away from the parked spot (new park save clears old)
window.clearParkReminders = function() {
  const id = parseInt(localStorage.getItem(PARK_TIMER_KEY) || '0', 10);
  if (id) clearInterval(id);
  localStorage.removeItem(PARK_TIME_KEY);
  localStorage.removeItem(PARK_TIMER_KEY);
};
