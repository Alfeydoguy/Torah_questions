// The topics students can choose from. Add, remove, or rename entries here;
// the student form and teacher filters both read from this list.
// Keep each `id` unchanged once questions use it, so old questions keep their label.
export const TOPIC_GROUPS = [
  {
    id: 'halacha',
    label: 'Halacha',
    topics: [
      { id: 'shabbos', label: 'Shabbos', hebrew: 'שבת' },
      { id: 'kashrus', label: 'Kashrus', hebrew: 'כשרות' },
      { id: 'tefillah', label: 'Tefillah', hebrew: 'תפילה' },
      { id: 'brachos', label: 'Brachos', hebrew: 'ברכות' },
      { id: 'moadim', label: 'Yom Tov & Moadim', hebrew: 'מועדים' },
      { id: 'bein-adam', label: 'Bein Adam LaChaveiro', hebrew: 'בין אדם לחברו' },
      { id: 'halacha-other', label: 'Other halacha', hebrew: 'הלכה' },
    ],
  },
  {
    id: 'torah',
    label: 'Torah',
    topics: [
      { id: 'chumash', label: 'Chumash & Parsha', hebrew: 'חומש' },
      { id: 'navi', label: 'Navi', hebrew: 'נביא' },
      { id: 'mishnah', label: 'Mishnah', hebrew: 'משנה' },
      { id: 'gemara', label: 'Gemara', hebrew: 'גמרא' },
      { id: 'hashkafa', label: 'Hashkafa & Emunah', hebrew: 'השקפה' },
      { id: 'torah-other', label: 'Other Torah topic', hebrew: 'תורה' },
    ],
  },
];

export function isTopic(id) {
  return TOPIC_GROUPS.some((group) => group.topics.some((topic) => topic.id === id));
}
