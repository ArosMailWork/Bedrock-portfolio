// Explicit demo content; replace these lines and URLs with the owner's real portfolio.
// title / lines: short, every character becomes a strip of trees.
// body (optional): paragraphs of any length, drawn as flat pixel text on the plot floor below the trees.
export const PLOTS = [
  { title: 'ABOUT', label: 'Who I am', lines: ['HI, I AM ALEX', 'CREATIVE DEV'], colors: [0xffa6a6, 0xffc3b9, 0xf68f96], note: 'Sample identity and introduction.',
    body: [
      "I'm a developer who builds from curiosity, not from tutorials. I started modding Minecraft in 2018 with nothing but a text editor in an iPad and the stubbornness to figure things out. That instinct to learn through building has defined everything since.",
      "I'm drawn to systems that demand both precision and creativity, where I can use my logical thinking with creativity. Scripting a complex boss, designing physics-driven gameplay, or architecting a developer toolchain: I care deeply about the craft behind all of it.",
      "Being multidisciplinary isn't a side effect for me, it's the point. I've spent most of my time learning and working across Bedrock scripting, software development, and various non-technical fields because I believe every domain sharpens your thinking in the others.",
      "I do my best work on ambitious projects with talented people who care about making their dreams a reality. If you're building something that pushes limits, I want to be part of it.",
    ] },
  { title: 'WORK', label: 'Selected work', lines: [], colors: [0x9bd957, 0xbdea77, 0x86c849], note: 'Title only: the WORK quadrant holds the career road and the social circle (work-area.js).' },
  { title: 'SKILLS', label: 'Toolbox', lines: [], colors: [0xffe85a, 0xfff48d, 0xf3d83d], note: 'Title only: the carnival fair (carnival.js) sits beside it.' },
  { title: 'CONTACT', label: 'Say hello', lines: ['SAY HELLO'], colors: [0x9bd957, 0xbdea77, 0x86c849], note: 'Placeholder contact, not a real inbox.', href: 'mailto:hello@example.com' },
];

// Career road (work-area.js, after bruno-simon.com's career area). One lane per job; dates are
// 'YYYY-MM'; end: null = current job (its block stays up at the end of the road).
// color: blue | orange | purple | green. Sample data: replace with the real career.
export const CAREER = {
  start: '2016-01', // first month on the year / month counter
  jobs: [
    { title: 'FREELANCER', lines: ['CREATIVE DEV.', 'Self-employed'], start: '2016-03', end: '2018-06', color: 'orange' },
    { title: 'STUDIO NORTH', lines: ['FRONTEND DEV.', 'Sample company'], start: '2018-07', end: '2021-02', color: 'purple' },
    { title: 'ONLINE TEACHER', lines: ['THREE.JS COURSE', '+400 STUDENTS (sample)'], start: '2020-04', end: '2023-09', color: 'blue' },
    { title: 'IMMERSIVE LAB', lines: ['CREATIVE TECHNOLOGIST'], start: '2021-03', end: null, color: 'green' },
  ],
};

// Social circle at the end of the career road: links on a half circle round the statue.
// align: which side of the point the label sits. Sample URLs: replace with the real profiles.
export const SOCIAL = [
  { name: 'X', url: 'https://x.com/example', align: 'right' },
  { name: 'Youtube', url: 'https://www.youtube.com/@example', align: 'right' },
  { name: 'Mail', url: 'mailto:hello@example.com', align: 'right' },
  { name: 'GitHub', url: 'https://github.com/example', align: 'left' },
  { name: 'LinkedIn', url: 'https://www.linkedin.com/in/example', align: 'left' },
  { name: 'Discord', url: 'https://discord.com/invite/example', align: 'left' },
];

// Projects board (showcase.js, after bruno-simon.com's projects area): left / right walks through
// each project's images, then on to the next project. images: URLs (optional; a placeholder card is
// drawn when empty). Sample data: replace with real projects.
export const PROJECTS = [
  { title: 'PORTFOLIO GARDEN', year: '2026', tags: ['Three.js', 'Rapier', 'GLSL'], url: 'https://example.com/garden', text: 'An island park where every line of text grows into trees.', images: [] },
  { title: '02 WORLDS', year: '2025', tags: ['WebGL', 'Blender'], url: 'https://example.com/worlds', text: 'Two small worlds linked by a portal (sample project).', images: [] },
  { title: 'BEDROCK BOSS', year: '2024', tags: ['Minecraft Bedrock', 'Scripting API'], url: 'https://example.com/boss', text: 'A scripted multi-phase boss fight (sample project).', images: [] },
];

// Lab (showcase.js, after bruno-simon.com's lab): small experiments and demos, picked from a list.
export const LAB = [
  { title: 'SDF FLOWERS', year: '2026', tags: ['GLSL'], url: 'https://example.com/lab/sdf', text: 'Procedural flowers from signed distance fields (sample).', images: [] },
  { title: 'CLOTH TOY', year: '2025', tags: ['Verlet'], url: 'https://example.com/lab/cloth', text: 'Drag a flag around in the wind (sample).', images: [] },
  { title: 'PIXEL FONT TREES', year: '2025', tags: ['Canvas'], url: 'https://example.com/lab/font', text: 'Text masks turned into tree layouts (sample).', images: [] },
  { title: 'SOUND GARDEN', year: '2024', tags: ['WebAudio'], url: 'https://example.com/lab/sound', text: 'Plants that hum when you walk past (sample).', images: [] },
];

// Carnival booths (carnival.js) south of the SKILLS plot, just for fun: four minigames round a
// little fair square. game: cans | ducks | rings | moles (one booth each, up to four).
export const CARNIVAL = [{ game: 'cans' }, { game: 'ducks' }, { game: 'rings' }, { game: 'moles' }];
