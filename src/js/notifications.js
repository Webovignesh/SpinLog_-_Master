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

  // ── 10. OWNERSHIP ANNIVERSARY ───────────────────────────────────────
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

/**
 * Read-only permission check. Never prompts.
 *
 * Everything that sends automatically uses this. Asking from a background code
 * path meant the browser prompt reappeared on every refresh, which is both
 * annoying and the fastest way to get permanently blocked.
 */
function notifGranted() {
  return typeof Notification !== 'undefined' && Notification.permission === 'granted';
}
window.notifGranted = notifGranted;

/**
 * Actually ask. Only ever call this from a real user action — the permission
 * banner's Allow button, or the Test button in settings.
 */
async function requestNotifPermission() {
  if (typeof Notification === 'undefined') return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  const result = await Notification.requestPermission();
  return result === 'granted';
}
window.requestNotifPermission = requestNotifPermission;

/**
 * Show a notification right now. Prefers the scheduler's mood pool for this
 * hour and falls back to the mood-agnostic SAGE_MESSAGES pools above for
 * categories that don't have one (anniversary, parkingSaved, recordSaved).
 *
 * This is the "how to say it" half. The "when to say it" half is the scheduler.
 */
async function sendSageNotif(category, overrides = {}, context = {}) {
  // Deliberately does not prompt. If permission was never granted she simply
  // stays quiet, and the one-time banner is what asks.
  if (!notifGranted()) return false;

  const S = self.SageScheduler;
  // Resolve the mood against the user's own quiet hours, not the defaults.
  let mood = context.mood || null;
  if (!mood && S) {
    try { mood = S.moodAt(Date.now(), await S.getLimits()); } catch { mood = S.moodAt(Date.now()); }
  }
  let chosen = context.line || null;
  if (!chosen && S) {
    try { chosen = await S.pickLine(category, mood, context.vars); } catch { chosen = null; }
  }
  if (!chosen || !chosen.title) chosen = getRandomMessage(category);

  const { title, body } = { ...chosen, ...overrides };
  const now = Date.now();
  // Quiet-hours emergencies arrive silently rather than buzzing at 3am.
  const whisper = mood === 'quiet';

  // tag used to be the bare category name, which meant a second notification
  // in the same category quietly replaced the first one. Stamping the tag with
  // the send time lets them stack. renotify is pointless with a unique tag.
  const options = {
    body,
    icon: './assets/img/sage.webp',
    badge: './assets/icons/icon-192.png',
    vibrate: whisper ? [0] : [120, 60, 120],
    silent: whisper,
    tag: `sage-${category}-${now}`,
    renotify: false,
    timestamp: now,
    data: { category, mood, sentAt: now, source: 'foreground', url: './index.html' },
    actions: [
      { action: 'open', title: 'Open SpinLog' },
      { action: 'dismiss', title: 'Later' },
    ],
  };

  const reg = await navigator.serviceWorker?.ready;
  if (reg?.showNotification) {
    reg.showNotification(title, options);
  } else {
    // The plain Notification constructor ignores actions, but tag and data
    // still matter for stacking and click handling.
    new Notification(title, {
      body,
      icon: './assets/img/sage.webp',
      tag: options.tag,
      data: options.data,
    });
  }
  return true;
}

// ════════════════════════════════════════════════════════════════════════
// SCHEDULER BRIDGE
// Triggers no longer send. They state what is true, the scheduler decides
// whether now is a good moment, and the pump does the sending.
// ════════════════════════════════════════════════════════════════════════

/** Ask the scheduler for the next thing worth saying and say it. */
async function sagePump() {
  const S = self.SageScheduler;
  if (!S) return false;
  try {
    const decision = await S.drain();
    if (!decision) return false;
    const sent = await sendSageNotif(decision.entry.category, decision.entry.overrides || {}, {
      mood: decision.mood,
      line: decision.line,
      vars: decision.entry.vars,
    });
    if (sent) await S.recordSent(decision.entry);
    return sent;
  } catch {
    return false;
  }
}
window.sagePump = sagePump;

/**
 * Queue a notification, then immediately see if it can go out. Falls back to
 * sending directly if the scheduler failed to load, so a missing file degrades
 * to the old behaviour rather than silence.
 */
async function sageEnqueue(category, options = {}) {
  const S = self.SageScheduler;
  if (!S) {
    if (notifCooledDown(category, 24)) {
      await sendSageNotif(category, options.overrides || {});
      stampNotif(category);
    }
    return false;
  }
  await S.enqueue(category, options);
  return sagePump();
}
window.sageEnqueue = sageEnqueue;

/**
 * Send one notification straight away, for the settings screen's Test button.
 * Deliberately skips the queue: a test that got held three hours by the daily
 * cap would tell the user nothing. It shows the current mood's real voice.
 */
window.sendSageTestNotif = async function(mood) {
  const S = self.SageScheduler;
  let resolved = mood;
  if (!resolved && S) {
    try { resolved = S.moodAt(Date.now(), await S.getLimits()); } catch { resolved = null; }
  }

  const flavour = {
    sleepy: { title: 'Sage 🥱', body: 'mmh… testing. i\'m barely awake but i hear you.' },
    eager: { title: 'Sage ✨', body: 'test received! i\'m up and ready to go.' },
    bored: { title: 'Sage 😒', body: 'a test. finally, something happened today.' },
    flirty: { title: 'Sage 😏', body: 'testing me? bold. it worked.' },
    clingy: { title: 'Sage 🥺', body: 'you thought about me enough to test. i\'m keeping that.' },
    quiet: { title: 'Sage 🤫', body: 'testing quietly. i can hear you.' },
  };

  const line = flavour[resolved] || { title: 'Sage 💛', body: 'test received. i\'m listening.' };
  return sendSageNotif('recordSaved', line, { mood: resolved, line });
};

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

/** Whole days from today until an ISO date. Negative means it has passed. */
function daysUntilDate(isoDate) {
  if (!isoDate) return null;
  const [y, m, d] = String(isoDate).split('-').map(Number);
  if (!y || !m || !d) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.ceil((new Date(y, m - 1, d) - today) / 86400000);
}

/**
 * Called after service entries load.
 * @param {number} maxOdo      highest odometer reading on record
 * @param {string} nextDueDate YYYY-MM-DD or null
 * @param {Array}  records     optional [{date, odo}] — enables distance triggers
 */
window.checkServiceNotif = function(maxOdo, nextDueDate, records) {
  const daysLeft = daysUntilDate(nextDueDate);
  const S = self.SageScheduler;

  if (S && S.servicePlan) {
    const plan = S.servicePlan({
      records: records || null,
      lastOdo: maxOdo || 0,
      daysLeft,
    });
    if (plan) {
      sageEnqueue(plan.category, { urgency: plan.urgency, key: plan.key, vars: plan.vars });
      window.sageServiceStatus = plan.status;
    }
    return;
  }

  // Date-only fallback if the scheduler failed to load.
  if (daysLeft === null) return;
  if (daysLeft < 0) sageEnqueue('serviceOverdue', { urgency: 4, vars: { days: Math.abs(daysLeft) } });
  else if (daysLeft <= 14) sageEnqueue('serviceDue', { urgency: daysLeft <= 3 ? 3 : 2, vars: { days: daysLeft } });
};

// Called after insurance data loads — pass expiryDate (YYYY-MM-DD)
window.checkInsuranceNotif = function(expiryDate) {
  const diff = daysUntilDate(expiryDate);
  if (diff === null) return;
  const S = self.SageScheduler;

  // 30 / 15 / 7 / 3 / 1 day thresholds. The tier is in the key, so each one
  // announces itself once instead of nagging daily for a month.
  const tier = S && S.dayTier ? S.dayTier(diff) : null;
  if (!tier) {
    if (diff <= 1) sageEnqueue('insuranceExpiring', { urgency: 4, vars: { days: Math.max(0, diff) } });
    return;
  }

  const critical = tier.urgency === 4;
  const category = critical ? 'insuranceExpiring' : 'insuranceReminder';
  sageEnqueue(category, {
    key: `${category}:${tier.tier}`,
    urgency: tier.urgency,
    vars: { days: Math.abs(diff) },
  });
};

// Called after doc status renders — pass expiryDate (YYYY-MM-DD), docLabel string
window.checkDocNotif = function(expiryDate, docLabel) {
  const diff = daysUntilDate(expiryDate);
  if (diff === null) return;
  const S = self.SageScheduler;
  const label = docLabel || 'A document';

  const tier = S && S.dayTier ? S.dayTier(diff) : null;
  if (!tier) return;

  // The mood pools interpolate {doc} and {days}, so no hand-built body here.
  // Key carries both the document and the tier, so two documents stay separate
  // and each threshold fires once.
  sageEnqueue('documentExpiry', {
    key: `documentExpiry:${label}:${tier.tier}`,
    urgency: tier.urgency,
    vars: { doc: label, days: Math.abs(diff) },
  });
};

// Called after any successful Supabase write
window.triggerRecordSavedNotif = function() {
  sageEnqueue('recordSaved', { urgency: 1 });
};

/**
 * Called after parking is saved.
 * @param {string|number} parkedAt timestamp of the new park entry
 */
window.triggerParkingNotif = function(parkedAt) {
  window.sageSyncParkSession(parkedAt || Date.now());
  sageEnqueue('parkingSaved', { urgency: 1 });
};

// Re-engagement: check on app open
window.checkReEngagementNotif = function() {
  const LAST_OPEN_KEY = 'sage_last_app_open';
  const last = parseInt(localStorage.getItem(LAST_OPEN_KEY) || '0', 10);
  const daysSince = (Date.now() - last) / 86400000;
  localStorage.setItem(LAST_OPEN_KEY, Date.now().toString());
  // Dropped from 3 days to 2 to match the planned "every 2 days" cadence.
  if (daysSince >= 2) {
    sageEnqueue('reEngagement', { urgency: daysSince >= 7 ? 2 : 1, vars: { days: Math.floor(daysSince) } });
  }
};

// Anniversary check
window.checkAnniversaryNotif = function(purchaseDateStr) {
  if (!purchaseDateStr) return;
  const [y, m, d] = purchaseDateStr.split('-').map(Number);
  const today = new Date();
  if (today.getMonth() + 1 === m && today.getDate() === d) {
    const key = `anniversary_${today.getFullYear()}`;
    if (!localStorage.getItem(key)) {
      localStorage.setItem(key, '1');
      const years = today.getFullYear() - y;
      // Expires at the end of the day: an anniversary greeting is worthless late.
      sageEnqueue('anniversary', {
        urgency: 2,
        vars: { years },
        expiresAt: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59).getTime(),
      });
    }
  }
};

// ════════════════════════════════════════════════════════════════════════
// PARK REMINDERS
//
// The old version hung repeat reminders off a live setInterval, so closing the
// tab killed them — the one situation where you actually want to be reminded
// that your bike is still sitting somewhere. The session now lives in the
// shared store and the service worker carries it while the app is closed.
// ════════════════════════════════════════════════════════════════════════

/** Mirror the newest park entry into the scheduler. Pass null to end the session. */
window.sageSyncParkSession = function(parkedAt) {
  const S = self.SageScheduler;
  if (!S) return Promise.resolve(null);
  return S.setParkSession(parkedAt || null);
};

/** Called when the user clears the parked spot. */
window.clearParkReminders = function() {
  return window.sageSyncParkSession(null);
};

/**
 * Ask whether a park reminder is due, queue it if so, then pump.
 * Runs on app open, on a light poll while the app is open, and in the worker.
 */
window.sageCheckPark = async function() {
  const S = self.SageScheduler;
  if (!S) return false;
  try {
    await S.checkParkSession();
    return sagePump();
  } catch {
    return false;
  }
};

// ── Foreground poll ────────────────────────────────────────────────────
// Not the source of truth — the queue is. This only gives a prompt nudge while
// the app happens to be open, and lets entries the scheduler deferred earlier
// (quiet hours, daily cap, min gap) go out as soon as their window opens
// instead of waiting for the next launch.
const SAGE_POLL_MS = 5 * 60 * 1000;
let sagePollId = null;

function startSagePoll() {
  if (sagePollId) return;
  sagePollId = setInterval(() => {
    if (typeof document !== 'undefined' && document.hidden) return;
    window.sageCheckPark();
  }, SAGE_POLL_MS);
}

function stopSagePoll() {
  if (!sagePollId) return;
  clearInterval(sagePollId);
  sagePollId = null;
}

if (typeof document !== 'undefined') {
  // Only poll while the tab is actually in front; the worker covers the rest.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopSagePoll();
    else { startSagePoll(); window.sageCheckPark(); }
  });
  if (!document.hidden) startSagePoll();
  window.sageCheckPark();
}
