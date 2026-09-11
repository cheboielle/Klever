export const themes={
 forest:{label:'Forest',accent:'#226A50',ink:'#153C32',soft:'#EAF0E7',paper:'#F5F6F0',line:'#DFE5DC'},
 ocean:{label:'Ocean',accent:'#176584',ink:'#173C4C',soft:'#E6F0F5',paper:'#F3F7F9',line:'#D9E5EC'},
 slate:{label:'Slate',accent:'#45566F',ink:'#253448',soft:'#E9EDF3',paper:'#F5F6F8',line:'#DFE3E9'},
 plum:{label:'Plum',accent:'#79466D',ink:'#462C40',soft:'#F2E8EF',paper:'#F8F4F7',line:'#E9DEE6'},
 terracotta:{label:'Terracotta',accent:'#9A4D32',ink:'#4D3028',soft:'#F5EBE5',paper:'#FAF6F2',line:'#EADFD7'},
} as const;
export type ThemeName=keyof typeof themes;
