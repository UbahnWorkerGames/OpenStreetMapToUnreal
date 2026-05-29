import json
import re

import unreal


STREET_SPLINES = json.loads("[{\"ObjectType\":\"OSM_SPLINE\",\"SplineKey\":\"major_road_Rhinstrasse_4689270_27942935_520492027_centerline\",\"Type\":\"major_road\",\"Shape\":\"line\",\"Street\":\"Rhinstraße\",\"OsmClass\":\"secondary\",\"WidthM\":7,\"bBridge\":false,\"bTunnel\":false,\"OsmLayer\":0,\"bClosed\":false,\"Points\":[[773499.2,-72833.3,0],[772897.4,-73272.2,0]]},{\"ObjectType\":\"OSM_SPLINE\",\"SplineKey\":\"major_road_Rhinstrasse_43796428_192505635_894678832_centerline\",\"Type\":\"major_road\",\"Shape\":\"line\",\"Street\":\"Rhinstraße\",\"OsmClass\":\"secondary\",\"WidthM\":7,\"bBridge\":false,\"bTunnel\":false,\"OsmLayer\":0,\"bClosed\":false,\"Points\":[[770753.9,142478.5,0],[771202.5,142552.2,0]]},{\"ObjectType\":\"OSM_SPLINE\",\"SplineKey\":\"major_road_Rhinstrasse_655436885_0\",\"Type\":\"major_road\",\"Shape\":\"line\",\"Street\":\"Rhinstraße\",\"OsmClass\":\"secondary\",\"WidthM\":7,\"bBridge\":false,\"bTunnel\":false,\"OsmLayer\":0,\"bClosed\":false,\"Points\":[[773508,-52501.9,0],[774073,-38650.3,0]]},{\"ObjectType\":\"OSM_SPLINE\",\"SplineKey\":\"major_road_Rhinstrasse_692490502_0\",\"Type\":\"major_road\",\"Shape\":\"line\",\"Street\":\"Rhinstraße\",\"OsmClass\":\"secondary\",\"WidthM\":7,\"bBridge\":false,\"bTunnel\":false,\"OsmLayer\":0,\"bClosed\":false,\"Points\":[[773466,-71053.3,0],[773520.9,-66453.6,0]]},{\"ObjectType\":\"OSM_SPLINE\",\"SplineKey\":\"major_road_Rhinstrasse_1134445112_0\",\"Type\":\"major_road\",\"Shape\":\"line\",\"Street\":\"Rhinstraße\",\"OsmClass\":\"secondary\",\"WidthM\":7,\"bBridge\":false,\"bTunnel\":false,\"OsmLayer\":0,\"bClosed\":false,\"Points\":[[770968.6,140405.7,0],[771672.4,128667,0]]},{\"ObjectType\":\"OSM_SPLINE\",\"SplineKey\":\"major_road_Alt_Friedrichsfelde_4068091_165420541_centerline\",\"Type\":\"major_road\",\"Shape\":\"line\",\"Street\":\"Alt-Friedrichsfelde\",\"OsmClass\":\"primary\",\"WidthM\":7,\"bBridge\":false,\"bTunnel\":false,\"OsmLayer\":0,\"bClosed\":false,\"Points\":[[776567,-115668.7,0],[784990.1,-115778.9,0],[794468.6,-115185.8,0],[811835.4,-111820.4,0]]},{\"ObjectType\":\"OSM_SPLINE\",\"SplineKey\":\"major_road_Alt_Friedrichsfelde_4689192_0\",\"Type\":\"major_road\",\"Shape\":\"line\",\"Street\":\"Alt-Friedrichsfelde\",\"OsmClass\":\"secondary_link\",\"WidthM\":7,\"bBridge\":false,\"bTunnel\":false,\"OsmLayer\":0,\"bClosed\":false,\"Points\":[[770816.9,-105229.7,0],[770113.8,-107876.9,0],[768487.4,-110475.1,0]]},{\"ObjectType\":\"OSM_SPLINE\",\"SplineKey\":\"major_road_Alt_Friedrichsfelde_6274920_32644397_centerline\",\"Type\":\"major_road\",\"Shape\":\"line\",\"Street\":\"Alt-Friedrichsfelde\",\"OsmClass\":\"primary\",\"WidthM\":7,\"bBridge\":false,\"bTunnel\":false,\"OsmLayer\":0,\"bClosed\":false,\"Points\":[[767082.9,-114606.7,0],[736596.4,-110057.6,0]]},{\"ObjectType\":\"OSM_SPLINE\",\"SplineKey\":\"major_road_Alt_Friedrichsfelde_137866458_137866467_706118835_centerline\",\"Type\":\"major_road\",\"Shape\":\"line\",\"Street\":\"Alt-Friedrichsfelde\",\"OsmClass\":\"secondary\",\"WidthM\":3.5,\"bBridge\":false,\"bTunnel\":false,\"OsmLayer\":0,\"bClosed\":false,\"Points\":[[771049.2,-116205.8,0],[772668.4,-116004.3,0]]},{\"ObjectType\":\"OSM_SPLINE\",\"SplineKey\":\"major_road_Alt_Friedrichsfelde_137866491_706118834_centerline\",\"Type\":\"major_road\",\"Shape\":\"line\",\"Street\":\"Alt-Friedrichsfelde\",\"OsmClass\":\"secondary\",\"WidthM\":3.5,\"bBridge\":false,\"bTunnel\":false,\"OsmLayer\":0,\"bClosed\":false,\"Points\":[[772657.6,-114522.7,0],[770657,-113572,0]]},{\"ObjectType\":\"OSM_SPLINE\",\"SplineKey\":\"major_road_Tunnel_Alt_Friedrichsfelde_4689185_4689188_centerline\",\"Type\":\"major_road\",\"Shape\":\"line\",\"Street\":\"Tunnel Alt-Friedrichsfelde\",\"OsmClass\":\"primary\",\"WidthM\":7,\"bBridge\":false,\"bTunnel\":true,\"OsmLayer\":-1,\"bClosed\":false,\"Points\":[[776567,-115668.7,0],[767082.9,-114606.7,0]]},{\"ObjectType\":\"OSM_SPLINE\",\"SplineKey\":\"major_road_Allee_der_Kosmonauten_222182354_0\",\"Type\":\"major_road\",\"Shape\":\"line\",\"Street\":\"Allee der Kosmonauten\",\"OsmClass\":\"secondary\",\"WidthM\":3.5,\"bBridge\":false,\"bTunnel\":false,\"OsmLayer\":0,\"bClosed\":false,\"Points\":[[839519.3,62349.2,0],[831629.3,62390.4,0],[818115.2,63324.4,0]]},{\"ObjectType\":\"OSM_SPLINE\",\"SplineKey\":\"major_road_Allee_der_Kosmonauten_899494645_1442798270_centerline\",\"Type\":\"major_road\",\"Shape\":\"line\",\"Street\":\"Allee der Kosmonauten\",\"OsmClass\":\"secondary\",\"WidthM\":7,\"bBridge\":false,\"bTunnel\":false,\"OsmLayer\":0,\"bClosed\":false,\"Points\":[[841063.7,60062.7,0],[840986.8,60104.5,0]]},{\"ObjectType\":\"OSM_SPLINE\",\"SplineKey\":\"major_road_Allee_der_Kosmonauten_1442798268_1442798269_centerline\",\"Type\":\"major_road\",\"Shape\":\"line\",\"Street\":\"Allee der Kosmonauten\",\"OsmClass\":\"secondary\",\"WidthM\":3.5,\"bBridge\":false,\"bTunnel\":false,\"OsmLayer\":0,\"bClosed\":false,\"Points\":[[841132.1,62314.7,0],[841053.5,62301.9,0]]},{\"ObjectType\":\"OSM_SPLINE\",\"SplineKey\":\"major_road_Landsberger_Allee_4696042_191635999_centerline\",\"Type\":\"major_road\",\"Shape\":\"line\",\"Street\":\"Landsberger Allee\",\"OsmClass\":\"primary\",\"WidthM\":14,\"bBridge\":false,\"bTunnel\":false,\"OsmLayer\":0,\"bClosed\":false,\"Points\":[[759932.3,171362.7,0],[762360,171573.6,0]]},{\"ObjectType\":\"OSM_SPLINE\",\"SplineKey\":\"major_road_Landsberger_Allee_110147009_0\",\"Type\":\"major_road\",\"Shape\":\"line\",\"Street\":\"Landsberger Allee\",\"OsmClass\":\"primary\",\"WidthM\":17.5,\"bBridge\":false,\"bTunnel\":false,\"OsmLayer\":0,\"bClosed\":false,\"Points\":[[767960.9,173075.9,0],[761994.2,172331.2,0]]},{\"ObjectType\":\"OSM_SPLINE\",\"SplineKey\":\"major_road_Frankfurter_Allee_41424937_0\",\"Type\":\"major_road\",\"Shape\":\"line\",\"Street\":\"Frankfurter Allee\",\"OsmClass\":\"primary\",\"WidthM\":14,\"bBridge\":true,\"bTunnel\":false,\"OsmLayer\":1,\"bClosed\":false,\"Points\":[[628281.7,-96196.1,0],[642168.3,-98306.7,0]]},{\"ObjectType\":\"OSM_SPLINE\",\"SplineKey\":\"major_road_Frankfurter_Allee_41424988_310172807_centerline\",\"Type\":\"major_road\",\"Shape\":\"line\",\"Street\":\"Frankfurter Allee\",\"OsmClass\":\"primary\",\"WidthM\":14,\"bBridge\":false,\"bTunnel\":false,\"OsmLayer\":0,\"bClosed\":false,\"Points\":[[629253.4,-95657.3,0],[614108.5,-93553.2,0]]},{\"ObjectType\":\"OSM_SPLINE\",\"SplineKey\":\"major_road_Frankfurter_Allee_502869472_1335772139_centerline\",\"Type\":\"major_road\",\"Shape\":\"line\",\"Street\":\"Frankfurter Allee\",\"OsmClass\":\"primary\",\"WidthM\":14,\"bBridge\":false,\"bTunnel\":false,\"OsmLayer\":0,\"bClosed\":false,\"Points\":[[669980.3,-102897,0],[674769.6,-103532.1,0]]},{\"ObjectType\":\"OSM_SPLINE\",\"SplineKey\":\"major_road_Frankfurter_Allee_1335772141_0\",\"Type\":\"major_road\",\"Shape\":\"line\",\"Street\":\"Frankfurter Allee\",\"OsmClass\":\"primary\",\"WidthM\":14,\"bBridge\":false,\"bTunnel\":false,\"OsmLayer\":0,\"bClosed\":false,\"Points\":[[676067.7,-103063.4,0],[674649.3,-102885.3,0]]},{\"ObjectType\":\"OSM_SPLINE\",\"SplineKey\":\"major_road_Gensinger_Strasse_11897422_0\",\"Type\":\"major_road\",\"Shape\":\"line\",\"Street\":\"Gensinger Straße\",\"OsmClass\":\"primary_link\",\"WidthM\":7,\"bBridge\":false,\"bTunnel\":false,\"OsmLayer\":0,\"bClosed\":false,\"Points\":[[863697.1,-106629,0],[863815.7,-105064.9,0]]},{\"ObjectType\":\"OSM_SPLINE\",\"SplineKey\":\"major_road_Suedliche_Rhinstrassenbruecke_11663312_0\",\"Type\":\"major_road\",\"Shape\":\"line\",\"Street\":\"Südliche Rhinstraßenbrücke\",\"OsmClass\":\"secondary\",\"WidthM\":7,\"bBridge\":true,\"bTunnel\":false,\"OsmLayer\":2,\"bClosed\":false,\"Points\":[[771367.6,-61848.3,0],[771294.4,-66502.6,0]]},{\"ObjectType\":\"OSM_SPLINE\",\"SplineKey\":\"major_road_B_1_B_5_28818695_846978764_centerline\",\"Type\":\"major_road\",\"Shape\":\"line\",\"Street\":\"B 1;B 5\",\"OsmClass\":\"primary\",\"WidthM\":14,\"bBridge\":false,\"bTunnel\":false,\"OsmLayer\":0,\"bClosed\":false,\"Points\":[[820318,-110035.9,0],[811835.4,-111820.4,0]]},{\"ObjectType\":\"OSM_SPLINE\",\"SplineKey\":\"major_road_Maerkische_Allee_1145124853_0\",\"Type\":\"major_road\",\"Shape\":\"line\",\"Street\":\"Märkische Allee\",\"OsmClass\":\"primary\",\"WidthM\":10.5,\"bBridge\":false,\"bTunnel\":false,\"OsmLayer\":0,\"bClosed\":false,\"Points\":[[895889.1,173075.9,0],[895872.7,172986.8,0]]},{\"ObjectType\":\"OSM_SPLINE\",\"SplineKey\":\"major_road_Maerkische_Allee_1434877871_1434877872_centerline\",\"Type\":\"major_road\",\"Shape\":\"line\",\"Street\":\"Märkische Allee\",\"OsmClass\":\"primary\",\"WidthM\":10.5,\"bBridge\":false,\"bTunnel\":false,\"OsmLayer\":0,\"bClosed\":false,\"Points\":[[893575.7,112961.4,0],[893571,112862.9,0]]},{\"ObjectType\":\"OSM_SPLINE\",\"SplineKey\":\"major_road_Noerdliche_Rhinstrassenbruecke_222182356_222182357_centerline\",\"Type\":\"major_road\",\"Shape\":\"line\",\"Street\":\"Nördliche Rhinstraßenbrücke\",\"OsmClass\":\"secondary\",\"WidthM\":10.5,\"bBridge\":true,\"bTunnel\":false,\"OsmLayer\":1,\"bClosed\":false,\"Points\":[[772734.8,125580.1,0],[772722.3,126300.3,0]]},{\"ObjectType\":\"OSM_SPLINE\",\"SplineKey\":\"major_road_Hauptstrasse_230102147_230102147_0\",\"Type\":\"major_road\",\"Shape\":\"line\",\"Street\":\"Hauptstrasse 230102147\",\"OsmClass\":\"primary_link\",\"WidthM\":3.5,\"bBridge\":false,\"bTunnel\":false,\"OsmLayer\":0,\"bClosed\":false,\"Points\":[[895677.6,82351.2,0],[896530.4,80980.8,0],[897384.5,77602.3,0],[898403.3,77055.7,0]]},{\"ObjectType\":\"OSM_SPLINE\",\"SplineKey\":\"major_road_Rhinstrasse_106874353_815558863_456120292_stitched\",\"Type\":\"major_road\",\"Shape\":\"line\",\"Street\":\"Rhinstraße\",\"OsmClass\":\"secondary_link\",\"WidthM\":3.5,\"bBridge\":false,\"bTunnel\":false,\"OsmLayer\":0,\"bClosed\":false,\"Points\":[[771914.2,125940.8,0],[771761.8,127151.9,0],[772577.7,127993.5,0]]},{\"ObjectType\":\"OSM_SPLINE\",\"SplineKey\":\"major_road_Rhinstrasse_223963811_1112865074_stitched\",\"Type\":\"major_road\",\"Shape\":\"line\",\"Street\":\"Rhinstraße\",\"OsmClass\":\"secondary\",\"WidthM\":9,\"bBridge\":false,\"bTunnel\":false,\"OsmLayer\":0,\"bClosed\":false,\"Points\":[[772389,-38692.6,0],[773749.9,-5977.9,0],[775499.5,-6044.7,0]]},{\"ObjectType\":\"OSM_SPLINE\",\"SplineKey\":\"major_road_Rhinstrasse_453373591_456120283_stitched\",\"Type\":\"major_road\",\"Shape\":\"line\",\"Street\":\"Rhinstraße\",\"OsmClass\":\"secondary\",\"WidthM\":7,\"bBridge\":false,\"bTunnel\":false,\"OsmLayer\":0,\"bClosed\":false,\"Points\":[[775223.8,97720,0],[773510.8,125939.7,0]]},{\"ObjectType\":\"OSM_SPLINE\",\"SplineKey\":\"major_road_Alt_Friedrichsfelde_42816695_1212181577_7619117_440392307_147557791_stitched\",\"Type\":\"major_road\",\"Shape\":\"line\",\"Street\":\"Alt-Friedrichsfelde\",\"OsmClass\":\"primary\",\"WidthM\":10.5,\"bBridge\":false,\"bTunnel\":false,\"OsmLayer\":0,\"bClosed\":false,\"Points\":[[880832.8,-108237,0],[887960.4,-109314,0],[899786.5,-110206.8,0],[900036.4,-110795.7,0]]},{\"ObjectType\":\"OSM_SPLINE\",\"SplineKey\":\"major_road_Alt_Friedrichsfelde_46099496_385542015_stitched\",\"Type\":\"major_road\",\"Shape\":\"line\",\"Street\":\"Alt-Friedrichsfelde\",\"OsmClass\":\"secondary\",\"WidthM\":3.5,\"bBridge\":false,\"bTunnel\":false,\"OsmLayer\":0,\"bClosed\":false,\"Points\":[[773330.6,-116804.7,0],[782179.7,-117250,0],[778484.6,-118494.6,0],[776674.7,-119820.4,0]]},{\"ObjectType\":\"OSM_SPLINE\",\"SplineKey\":\"major_road_Alt_Friedrichsfelde_165420542_1394173371_stitched\",\"Type\":\"major_road\",\"Shape\":\"line\",\"Street\":\"Alt-Friedrichsfelde\",\"OsmClass\":\"secondary\",\"WidthM\":7,\"bBridge\":false,\"bTunnel\":false,\"OsmLayer\":0,\"bClosed\":false,\"Points\":[[811568.5,-110951.5,0],[795040.1,-113677.8,0],[782247.4,-114321.2,0]]},{\"ObjectType\":\"OSM_SPLINE\",\"SplineKey\":\"major_road_Alt_Friedrichsfelde_192107802_7956208_46099493_stitched\",\"Type\":\"major_road\",\"Shape\":\"line\",\"Street\":\"Alt-Friedrichsfelde\",\"OsmClass\":\"secondary\",\"WidthM\":14,\"bBridge\":false,\"bTunnel\":false,\"OsmLayer\":0,\"bClosed\":false,\"Points\":[[773201.9,-107084.3,0],[774554.6,-109940.7,0],[776369.9,-112015.8,0],[778038.3,-113094.4,0],[782247.4,-114321.2,0],[773308.9,-113841.4,0],[772006.3,-115204,0]]},{\"ObjectType\":\"OSM_SPLINE\",\"SplineKey\":\"major_road_Alt_Friedrichsfelde_930349179_930349181_stitched\",\"Type\":\"major_road\",\"Shape\":\"line\",\"Street\":\"Alt-Friedrichsfelde\",\"OsmClass\":\"secondary_link\",\"WidthM\":7,\"bBridge\":false,\"bTunnel\":false,\"OsmLayer\":0,\"bClosed\":false,\"Points\":[[768316,-119184.8,0],[770602.8,-122689.1,0],[771452.2,-125310.7,0]]},{\"ObjectType\":\"OSM_SPLINE\",\"SplineKey\":\"major_road_Am_Tierpark_212440115_4689195_42993570_stitched\",\"Type\":\"major_road\",\"Shape\":\"line\",\"Street\":\"Am Tierpark\",\"OsmClass\":\"secondary\",\"WidthM\":10.5,\"bBridge\":false,\"bTunnel\":false,\"OsmLayer\":0,\"bClosed\":false,\"Points\":[[776674.7,-119820.4,0],[774035,-124640.6,0],[773308.9,-113841.4,0]]},{\"ObjectType\":\"OSM_SPLINE\",\"SplineKey\":\"major_road_Allee_der_Kosmonauten_4696025_453373584_stitched\",\"Type\":\"major_road\",\"Shape\":\"line\",\"Street\":\"Allee der Kosmonauten\",\"OsmClass\":\"secondary\",\"WidthM\":3.5,\"bBridge\":false,\"bTunnel\":false,\"OsmLayer\":0,\"bClosed\":false,\"Points\":[[817968.9,61738.1,0],[839369.6,60126.2,0]]},{\"ObjectType\":\"OSM_SPLINE\",\"SplineKey\":\"major_road_Allee_der_Kosmonauten_4696029_453373583_4696032_8029205_stitched\",\"Type\":\"major_road\",\"Shape\":\"line\",\"Street\":\"Allee der Kosmonauten\",\"OsmClass\":\"secondary\",\"WidthM\":3.5,\"bBridge\":false,\"bTunnel\":false,\"OsmLayer\":0,\"bClosed\":false,\"Points\":[[818042.1,62531.2,0],[798019.5,64137,0]]},{\"ObjectType\":\"OSM_SPLINE\",\"SplineKey\":\"major_road_Landsberger_Allee_110147012_191639335_stitched\",\"Type\":\"major_road\",\"Shape\":\"line\",\"Street\":\"Landsberger Allee\",\"OsmClass\":\"primary\",\"WidthM\":10.5,\"bBridge\":false,\"bTunnel\":false,\"OsmLayer\":0,\"bClosed\":false,\"Points\":[[762725.7,170816.1,0],[779373.9,173075.9,0]]},{\"ObjectType\":\"OSM_SPLINE\",\"SplineKey\":\"major_road_Frankfurter_Allee_6277268_318276285_stitched\",\"Type\":\"major_road\",\"Shape\":\"line\",\"Street\":\"Frankfurter Allee\",\"OsmClass\":\"primary\",\"WidthM\":14,\"bBridge\":false,\"bTunnel\":false,\"OsmLayer\":0,\"bClosed\":false,\"Points\":[[670519.5,-102367.6,0],[652891,-99112.6,0]]},{\"ObjectType\":\"OSM_SPLINE\",\"SplineKey\":\"major_road_Frankfurter_Allee_37226927_37226971_6277270_37226970_992206428_1335772146_stitched\",\"Type\":\"major_road\",\"Shape\":\"line\",\"Street\":\"Frankfurter Allee\",\"OsmClass\":\"primary\",\"WidthM\":14,\"bBridge\":false,\"bTunnel\":false,\"OsmLayer\":0,\"bClosed\":false,\"Points\":[[642709.6,-97717.8,0],[652343.7,-99637,0]]},{\"ObjectType\":\"OSM_SPLINE\",\"SplineKey\":\"major_road_Frankfurter_Allee_46839074_992206429_stitched\",\"Type\":\"major_road\",\"Shape\":\"line\",\"Street\":\"Frankfurter Allee\",\"OsmClass\":\"primary\",\"WidthM\":14,\"bBridge\":true,\"bTunnel\":false,\"OsmLayer\":1,\"bClosed\":false,\"Points\":[[643250.8,-97128.9,0],[630225,-95118.5,0]]},{\"ObjectType\":\"OSM_SPLINE\",\"SplineKey\":\"major_road_Frankfurter_Allee_980125900_6277301_60769279_stitched\",\"Type\":\"major_road\",\"Shape\":\"line\",\"Street\":\"Frankfurter Allee\",\"OsmClass\":\"primary\",\"WidthM\":14,\"bBridge\":false,\"bTunnel\":false,\"OsmLayer\":0,\"bClosed\":false,\"Points\":[[651796.4,-100161.3,0],[669441.1,-103426.3,0]]},{\"ObjectType\":\"OSM_SPLINE\",\"SplineKey\":\"major_road_Gensinger_Strasse_147557795_898538741_stitched\",\"Type\":\"major_road\",\"Shape\":\"line\",\"Street\":\"Gensinger Straße\",\"OsmClass\":\"primary_link\",\"WidthM\":3.5,\"bBridge\":false,\"bTunnel\":false,\"OsmLayer\":0,\"bClosed\":false,\"Points\":[[850465.5,-113529.7,0],[850502.8,-111296.6,0],[852047.1,-109123.7,0],[853247.4,-108394.5,0]]},{\"ObjectType\":\"OSM_SPLINE\",\"SplineKey\":\"major_road_Suedliche_Rhinstrassenbruecke_574670425_1185655784_stitched\",\"Type\":\"major_road\",\"Shape\":\"line\",\"Street\":\"Südliche Rhinstraßenbrücke\",\"OsmClass\":\"secondary\",\"WidthM\":7,\"bBridge\":true,\"bTunnel\":false,\"OsmLayer\":2,\"bClosed\":false,\"Points\":[[773520.9,-66453.6,0],[773508,-52501.9,0]]},{\"ObjectType\":\"OSM_SPLINE\",\"SplineKey\":\"major_road_Maerkische_Allee_194911201_432205814_40152321_1145124869_1145124865_1420121157_stitched\",\"Type\":\"major_road\",\"Shape\":\"line\",\"Street\":\"Märkische Allee\",\"OsmClass\":\"primary\",\"WidthM\":10.5,\"bBridge\":false,\"bTunnel\":false,\"OsmLayer\":0,\"bClosed\":false,\"Points\":[[894805.5,161191.4,0],[896671.1,173031.4,0]]},{\"ObjectType\":\"OSM_SPLINE\",\"SplineKey\":\"major_road_Gensinger_Bruecke_51218885_1456100298_stitched\",\"Type\":\"major_road\",\"Shape\":\"line\",\"Street\":\"Gensinger Brücke\",\"OsmClass\":\"primary_link\",\"WidthM\":7,\"bBridge\":true,\"bTunnel\":false,\"OsmLayer\":1,\"bClosed\":false,\"Points\":[[863230.4,-113198,0],[863697.1,-106629,0]]},{\"ObjectType\":\"OSM_SPLINE\",\"SplineKey\":\"major_road_Rhinstrasse_4689191_1394173370_1394173369_4068148_27942931_stitched\",\"Type\":\"major_road\",\"Shape\":\"line\",\"Street\":\"Rhinstraße\",\"OsmClass\":\"secondary\",\"WidthM\":10.5,\"bBridge\":false,\"bTunnel\":false,\"OsmLayer\":0,\"bClosed\":false,\"Points\":[[771294.4,-66502.6,0],[770657,-113572,0]]},{\"ObjectType\":\"OSM_SPLINE\",\"SplineKey\":\"major_road_Rhinstrasse_234027893_1476448294_1476448295_4689342_137866502_stitched\",\"Type\":\"major_road\",\"Shape\":\"line\",\"Street\":\"Rhinstraße\",\"OsmClass\":\"secondary\",\"WidthM\":14,\"bBridge\":false,\"bTunnel\":false,\"OsmLayer\":0,\"bClosed\":false,\"Points\":[[773308.9,-113841.4,0],[773471.5,-74633.4,0]]},{\"ObjectType\":\"OSM_SPLINE\",\"SplineKey\":\"major_road_Alt_Friedrichsfelde_389508686_649125480_907071143_27959225_899210973_stitched\",\"Type\":\"major_road\",\"Shape\":\"line\",\"Street\":\"Alt-Friedrichsfelde\",\"OsmClass\":\"primary_link\",\"WidthM\":7,\"bBridge\":false,\"bTunnel\":false,\"OsmLayer\":0,\"bClosed\":false,\"Points\":[[881073.6,-107617.5,0],[863815.7,-105064.9,0],[857556.8,-104786.6,0],[842432.6,-105691.7,0],[831655.1,-107564.1,0]]},{\"ObjectType\":\"OSM_SPLINE\",\"SplineKey\":\"major_road_Alt_Friedrichsfelde_1456100347_846978762_846978763_699217505_865948248_1456100343_7956187_1456100342_stitched\",\"Type\":\"major_road\",\"Shape\":\"line\",\"Street\":\"Alt-Friedrichsfelde\",\"OsmClass\":\"secondary\",\"WidthM\":7,\"bBridge\":false,\"bTunnel\":false,\"OsmLayer\":0,\"bClosed\":false,\"Points\":[[782179.7,-117250,0],[793253.9,-116658.9,0],[803178,-115127.1,0],[812102.3,-112689.2,0]]},{\"ObjectType\":\"OSM_SPLINE\",\"SplineKey\":\"major_road_Am_Tierpark_1064830458_137866492_137866497_192107803_365895664_122749213_192487129_170421828_203986351_stitched\",\"Type\":\"major_road\",\"Shape\":\"line\",\"Street\":\"Am Tierpark\",\"OsmClass\":\"secondary\",\"WidthM\":7.7,\"bBridge\":false,\"bTunnel\":false,\"OsmLayer\":0,\"bClosed\":false,\"Points\":[[770657,-113572,0],[771839,-126687.7,0],[773648.3,-133457.1,0],[776786.5,-158234.7,0],[778595.7,-166735.1,0],[782558.3,-180376.2,0],[791560.7,-222064.5,0]]},{\"ObjectType\":\"OSM_SPLINE\",\"SplineKey\":\"major_road_Allee_der_Kosmonauten_28275819_192028819_1093323853_1442798267_stitched\",\"Type\":\"major_road\",\"Shape\":\"line\",\"Street\":\"Allee der Kosmonauten\",\"OsmClass\":\"secondary\",\"WidthM\":7,\"bBridge\":false,\"bTunnel\":false,\"OsmLayer\":0,\"bClosed\":false,\"Points\":[[774820.8,65151.1,0],[798372.8,63286.5,0]]},{\"ObjectType\":\"OSM_SPLINE\",\"SplineKey\":\"major_road_Allee_der_Kosmonauten_114686325_192497983_1442798266_895292906_935201701_stitched\",\"Type\":\"major_road\",\"Shape\":\"line\",\"Street\":\"Allee der Kosmonauten\",\"OsmClass\":\"secondary\",\"WidthM\":10.5,\"bBridge\":false,\"bTunnel\":false,\"OsmLayer\":0,\"bClosed\":false,\"Points\":[[797666.3,64987.5,0],[774666.3,67303,0]]},{\"ObjectType\":\"OSM_SPLINE\",\"SplineKey\":\"major_road_Landsberger_Allee_432205789_432205779_1313443923_191639332_191639338_42739063_287900688_86142781_191639341_stitched\",\"Type\":\"major_road\",\"Shape\":\"line\",\"Street\":\"Landsberger Allee\",\"OsmClass\":\"primary\",\"WidthM\":10.5,\"bBridge\":false,\"bTunnel\":false,\"OsmLayer\":0,\"bClosed\":false,\"Points\":[[614108.5,156821.4,0],[641715.9,158034.3,0],[760258.1,170581.2,0]]},{\"ObjectType\":\"OSM_SPLINE\",\"SplineKey\":\"major_road_Gensinger_Strasse_7619035_891218723_1056835405_147557794_1077056981_stitched\",\"Type\":\"major_road\",\"Shape\":\"line\",\"Street\":\"Gensinger Straße\",\"OsmClass\":\"primary_link\",\"WidthM\":12.9,\"bBridge\":false,\"bTunnel\":false,\"OsmLayer\":0,\"bClosed\":false,\"Points\":[[863230.4,-113198,0],[862361.4,-115851.8,0],[860155.9,-117705.3,0],[853043.6,-118145,0],[850497.8,-117076.7,0],[849337.7,-110794.6,0],[847507.4,-108243.1,0]]},{\"ObjectType\":\"OSM_SPLINE\",\"SplineKey\":\"major_road_B_1_B_5_27959212_440392306_1394173372_1456100338_stitched\",\"Type\":\"major_road\",\"Shape\":\"line\",\"Street\":\"B 1;B 5\",\"OsmClass\":\"primary\",\"WidthM\":10.5,\"bBridge\":false,\"bTunnel\":false,\"OsmLayer\":0,\"bClosed\":false,\"Points\":[[880592,-108856.5,0],[853139.1,-107057.6,0],[842737.4,-106954,0],[831655.1,-107564.1,0],[819910.9,-109394.2,0]]},{\"ObjectType\":\"OSM_SPLINE\",\"SplineKey\":\"major_road_B_1_B_5_28818696_316319552_316319553_27959208_224880788_stitched\",\"Type\":\"major_road\",\"Shape\":\"line\",\"Street\":\"B 1;B 5\",\"OsmClass\":\"primary\",\"WidthM\":14,\"bBridge\":false,\"bTunnel\":false,\"OsmLayer\":0,\"bClosed\":false,\"Points\":[[820725.1,-110677.7,0],[829032.3,-109361.9,0],[847507.4,-108243.1,0],[899736.3,-111347.8,0]]},{\"ObjectType\":\"OSM_SPLINE\",\"SplineKey\":\"major_road_Maerkische_Allee_432205812_1087866102_1087866101_1420817049_stitched\",\"Type\":\"major_road\",\"Shape\":\"line\",\"Street\":\"Märkische Allee\",\"OsmClass\":\"primary\",\"WidthM\":14,\"bBridge\":false,\"bTunnel\":false,\"OsmLayer\":0,\"bClosed\":false,\"Points\":[[893533,114475.9,0],[893314.2,127130.8,0],[893940.1,143872.2,0],[895520.4,161180.2,0]]},{\"ObjectType\":\"OSM_SPLINE\",\"SplineKey\":\"major_road_Maerkische_Allee_1023254680_1420817046_40152322_1145124958_1089002401_1420817047_stitched\",\"Type\":\"major_road\",\"Shape\":\"line\",\"Street\":\"Märkische Allee\",\"OsmClass\":\"primary\",\"WidthM\":10.5,\"bBridge\":false,\"bTunnel\":false,\"OsmLayer\":0,\"bClosed\":false,\"Points\":[[894090.5,161202.5,0],[892179.7,140248.7,0],[891757.7,125328.5,0],[892464.2,105805.2,0],[893901.5,90828.2,0],[900036.4,64489.6,0]]},{\"ObjectType\":\"OSM_SPLINE\",\"SplineKey\":\"major_road_Maerkische_Allee_1087866100_1420811155_1420811157_1420811156_1420811158_stitched\",\"Type\":\"major_road\",\"Shape\":\"line\",\"Street\":\"Märkische Allee\",\"OsmClass\":\"primary\",\"WidthM\":10.5,\"bBridge\":false,\"bTunnel\":false,\"OsmLayer\":0,\"bClosed\":false,\"Points\":[[900036.4,70257.9,0],[897100,82480.3,0],[894771.3,95547.1,0],[893618.4,111446.9,0]]},{\"ObjectType\":\"OSM_SPLINE\",\"SplineKey\":\"major_road_Rhinstrasse_43796425_45338884_106874364_453373587_192498000_1101185428_593282581_4067949_11663469_stitched\",\"Type\":\"major_road\",\"Shape\":\"line\",\"Street\":\"Rhinstraße\",\"OsmClass\":\"secondary\",\"WidthM\":7,\"bBridge\":false,\"bTunnel\":false,\"OsmLayer\":0,\"bClosed\":false,\"Points\":[[771367.6,-61848.3,0],[772389,-38692.6,0],[774073,-38650.3,0],[777663.7,43352.5,0],[777484.2,65082.1,0],[775223.8,97720,0],[773303.5,97663.3,0]]},{\"ObjectType\":\"OSM_SPLINE\",\"SplineKey\":\"major_road_Rhinstrasse_45511636_453373589_453373590_1101185425_1112865075_1445472803_170983744_192498001_1458036120_1112865072_56473166_1101185429_stitched\",\"Type\":\"major_road\",\"Shape\":\"line\",\"Street\":\"Rhinstraße\",\"OsmClass\":\"secondary\",\"WidthM\":7,\"bBridge\":false,\"bTunnel\":false,\"OsmLayer\":0,\"bClosed\":false,\"Points\":[[771958.9,125220.5,0],[776029.2,46490.6,0],[773749.9,-5977.9,0]]},{\"ObjectType\":\"OSM_SPLINE\",\"SplineKey\":\"major_road_Rhinstrasse_191640672_888311297_191640673_938252956_453373588_456120284_936867360_43796424_59636545_stitched\",\"Type\":\"major_road\",\"Shape\":\"line\",\"Street\":\"Rhinstraße\",\"OsmClass\":\"secondary\",\"WidthM\":17.5,\"bBridge\":false,\"bTunnel\":false,\"OsmLayer\":0,\"bClosed\":false,\"Points\":[[773530.4,126659.9,0],[772673.5,142762.3,0],[772051.7,146348,0],[767976,158632.1,0],[761649.6,173075.9,0]]},{\"ObjectType\":\"OSM_SPLINE\",\"SplineKey\":\"major_road_Rhinstrasse_192505634_1134445111_285823527_1434586385_1143845146_1220441310_26184615_191642219_191641493_868066952_stitched\",\"Type\":\"major_road\",\"Shape\":\"line\",\"Street\":\"Rhinstraße\",\"OsmClass\":\"secondary_link\",\"WidthM\":3.5,\"bBridge\":false,\"bTunnel\":false,\"OsmLayer\":0,\"bClosed\":false,\"Points\":[[772673.5,142762.3,0],[770583.9,143520.4,0],[768481.3,152084.3,0],[759165.7,173075.9,0]]},{\"ObjectType\":\"OSM_SPLINE\",\"SplineKey\":\"major_road_Alt_Friedrichsfelde_4689194_46099492_1455510147_4571601_223288634_1394173368_1455510146_1455510143_1455510144_4689026_1335772145_1335772144_1455510142_stitched\",\"Type\":\"major_road\",\"Shape\":\"line\",\"Street\":\"Alt-Friedrichsfelde\",\"OsmClass\":\"secondary_link\",\"WidthM\":7,\"bBridge\":false,\"bTunnel\":false,\"OsmLayer\":0,\"bClosed\":false,\"Points\":[[674889.8,-104178.8,0],[724924.7,-109229.4,0],[736338.3,-110888.1,0],[743005.6,-112648,0],[762314.6,-115621.4,0],[769523.1,-117862.3,0]]},{\"ObjectType\":\"OSM_SPLINE\",\"SplineKey\":\"major_road_Alt_Friedrichsfelde_32644395_320892561_42816694_46099491_192487125_899413473_985468026_429217919_4068118_391866690_stitched\",\"Type\":\"major_road\",\"Shape\":\"line\",\"Street\":\"Alt-Friedrichsfelde\",\"OsmClass\":\"primary\",\"WidthM\":10.5,\"bBridge\":false,\"bTunnel\":false,\"OsmLayer\":0,\"bClosed\":false,\"Points\":[[769572.2,-112023.5,0],[763600.9,-112543.4,0],[743952.6,-109663.6,0],[676067.7,-103063.4,0]]},{\"ObjectType\":\"OSM_SPLINE\",\"SplineKey\":\"major_road_Am_Tierpark_81631452_192487127_192487126_980136988_192487128_1394173373_1394173374_122749214_431340311_stitched\",\"Type\":\"major_road\",\"Shape\":\"line\",\"Street\":\"Am Tierpark\",\"OsmClass\":\"secondary\",\"WidthM\":7.8,\"bBridge\":false,\"bTunnel\":false,\"OsmLayer\":0,\"bClosed\":false,\"Points\":[[793186.3,-222064.5,0],[788561.1,-200437.2,0],[786360.4,-193503.1,0],[782837.4,-175044,0],[778203.5,-157421,0],[774035,-124640.6,0]]},{\"ObjectType\":\"OSM_SPLINE\",\"SplineKey\":\"major_road_Allee_der_Kosmonauten_4696024_334908575_334908573_334908578_453373585_899411171_931265044_4696027_27942876_stitched\",\"Type\":\"major_road\",\"Shape\":\"line\",\"Street\":\"Allee der Kosmonauten\",\"OsmClass\":\"secondary\",\"WidthM\":7,\"bBridge\":true,\"bTunnel\":false,\"OsmLayer\":2,\"bClosed\":false,\"Points\":[[900036.4,65255.4,0],[842587.7,62254.6,0]]},{\"ObjectType\":\"OSM_SPLINE\",\"SplineKey\":\"major_road_Allee_der_Kosmonauten_334908574_334908576_334908577_4696028_27942882_1101185623_1442798271_1448366570_222182355_931265043_stitched\",\"Type\":\"major_road\",\"Shape\":\"line\",\"Street\":\"Allee der Kosmonauten\",\"OsmClass\":\"secondary\",\"WidthM\":7,\"bBridge\":true,\"bTunnel\":false,\"OsmLayer\":2,\"bClosed\":false,\"Points\":[[842604,60082.7,0],[900036.4,62833.4,0]]},{\"ObjectType\":\"OSM_SPLINE\",\"SplineKey\":\"major_road_Landsberger_Allee_42739062_432205778_86142785_287900691_432205782_432205784_432205783_86142782_432205780_stitched\",\"Type\":\"major_road\",\"Shape\":\"line\",\"Street\":\"Landsberger Allee\",\"OsmClass\":\"primary\",\"WidthM\":10.5,\"bBridge\":false,\"bTunnel\":false,\"OsmLayer\":0,\"bClosed\":false,\"Points\":[[759606.5,172144.1,0],[692430.9,164868.3,0],[628357.5,158788,0],[614108.5,158486.5,0]]}]")
BUILDINGS = json.loads("[]")
TREES = json.loads("[]")
PROPS = json.loads("[]")
BP_PATHS = json.loads("{\"tunnel\":\"/Game/_UbahnWorkerGames/TEST/BP_CityTest.BP_CityTest\",\"subway\":\"/Game/_UbahnWorkerGames/TEST/BP_CityTest.BP_CityTest\",\"tram\":\"/Game/_UbahnWorkerGames/TEST/BP_CityTest.BP_CityTest\",\"train\":\"/Game/_UbahnWorkerGames/TEST/BP_CityTest.BP_CityTest\",\"bus\":\"/Game/_UbahnWorkerGames/TEST/BP_CityTest.BP_CityTest\",\"street\":\"/Game/_UbahnWorkerGames/TEST/BP_CityTest.BP_CityTest\",\"building\":\"/Game/_UbahnWorkerGames/TEST/BP_BuildingCube.BP_BuildingCube\",\"tree\":\"/Game/_UbahnWorkerGames/TEST/BP_BuildingCube.BP_BuildingCube\",\"prop\":\"/Game/_UbahnWorkerGames/TEST/BP_BuildingCube.BP_BuildingCube\"}")
ACTOR_LABEL_PREFIX = "CITY_STREET"
BUILDING_ACTOR_LABEL_PREFIX = "OSM_BUILDING"
TREE_ACTOR_LABEL_PREFIX = "OSM_TREE"
PROP_ACTOR_LABEL_PREFIX = "OSM_PROP"
SPLINE_COMPONENT_NAMES = ["StreetSpline", "Spline"]
WORLD_OFFSET_CM = unreal.Vector(0.0, 0.0, 0.0)
FORCE_ZERO_Z = True
LINEAR_SPLINES = True
CUBE_BASE_CM = 100.0


def fail(message):
    unreal.log_error(message)
    raise RuntimeError(message)


def destroy_existing_actor_with_prefix(prefix):
    for actor in unreal.EditorLevelLibrary.get_all_level_actors():
        if actor.get_actor_label().startswith(prefix):
            unreal.EditorLevelLibrary.destroy_actor(actor)


def destroy_existing_actor_with_label(label):
    for actor in unreal.EditorLevelLibrary.get_all_level_actors():
        if actor.get_actor_label() == label:
            unreal.EditorLevelLibrary.destroy_actor(actor)


def load_bp_class(asset_path):
    asset_class = unreal.EditorAssetLibrary.load_blueprint_class(asset_path)
    if asset_class is None:
        fail(f"Could not load Blueprint class: {asset_path}")
    return asset_class


def bp_kind_for_row(row):
    if bool(row.get("bTunnel", False)):
        return "tunnel"
    row_type = str(row.get("Type", ""))
    if row_type == "rail_subway":
        return "subway"
    if row_type == "rail_tram":
        return "tram"
    if row_type == "rail_train":
        return "train"
    if row_type == "bus":
        return "bus"
    return "street"


def bp_class_for_row(row, cache):
    kind = bp_kind_for_row(row)
    asset_path = BP_PATHS.get(kind) or BP_PATHS.get("street")
    if not isinstance(asset_path, str) or not asset_path.strip():
        fail(f"No Blueprint path configured for kind '{kind}'")
    if asset_path not in cache:
        cache[asset_path] = load_bp_class(asset_path)
    return cache[asset_path]


def sanitize_label_part(value):
    sanitized = re.sub(r"[^A-Za-z0-9_]+", "_", str(value)).strip("_")
    return sanitized or "Unnamed"


def point_to_vector(point):
    if not isinstance(point, list) or len(point) != 3:
        fail(f"Invalid point: {point}")
    x, y, z = point
    if isinstance(x, bool) or isinstance(y, bool) or isinstance(z, bool):
        fail(f"Invalid bool coordinate in point: {point}")
    if not isinstance(x, (int, float)) or not isinstance(y, (int, float)) or not isinstance(z, (int, float)):
        fail(f"Invalid numeric coordinate in point: {point}")
    return unreal.Vector(
        float(x) + WORLD_OFFSET_CM.x,
        float(y) + WORLD_OFFSET_CM.y,
        (0.0 if FORCE_ZERO_Z else float(z)) + WORLD_OFFSET_CM.z,
    )


def require_spline(row, index):
    if not isinstance(row, dict):
        fail(f"Spline {index} must be an object")
    key = row.get("SplineKey")
    points = row.get("Points")
    if not isinstance(key, str) or not key:
        fail(f"Spline {index} has no valid SplineKey")
    if not isinstance(points, list) or len(points) < 2:
        fail(f"Spline '{key}' needs at least 2 points")
    return row


def find_spline_component(actor):
    spline_components = actor.get_components_by_class(unreal.SplineComponent)
    for component_name in SPLINE_COMPONENT_NAMES:
        for component in spline_components:
            if component.get_name() == component_name:
                return component
    if spline_components:
        return spline_components[0]
    fail(f"No SplineComponent found on actor '{actor.get_actor_label()}'. Add one to BP_CityTest.")


def set_editor_property_if_present(obj, property_name, value):
    try:
        obj.set_editor_property(property_name, value)
        return True
    except Exception:
        return False


def set_tags(actor, tags):
    actor.tags = [unreal.Name(str(tag)) for tag in tags if str(tag)]


def payload_value(value):
    if value is None:
        return ""
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    return str(value)


def set_payload_if_present(actor, row, object_type):
    payload = {str(key): payload_value(value) for key, value in dict(row).items()}
    payload["ObjectType"] = object_type
    if not set_editor_property_if_present(actor, "payload", payload):
        return False
    return True


def configure_spline_component(spline_component, row):
    set_editor_property_if_present(spline_component, "override_construction_script", False)
    set_editor_property_if_present(spline_component, "input_spline_points_to_construction_script", True)
    spline_component.clear_spline_points(False)
    for point in row["Points"]:
        spline_component.add_spline_point(point_to_vector(point), unreal.SplineCoordinateSpace.WORLD, False)
    for index in range(len(row["Points"])):
        point_type = unreal.SplinePointType.LINEAR if LINEAR_SPLINES else unreal.SplinePointType.CURVE
        spline_component.set_spline_point_type(index, point_type, False)
    if hasattr(spline_component, "set_closed_loop"):
        spline_component.set_closed_loop(bool(row.get("bClosed", False)), False)
    elif bool(row.get("bClosed", False)):
        fail("SplineComponent does not expose set_closed_loop, but the source spline is closed")
    spline_component.update_spline()


def spline_world_location_at_point(spline_component, index):
    if hasattr(spline_component, "get_location_at_spline_point"):
        return spline_component.get_location_at_spline_point(index, unreal.SplineCoordinateSpace.WORLD)
    if hasattr(spline_component, "get_location_at_spline_input_key"):
        return spline_component.get_location_at_spline_input_key(float(index), unreal.SplineCoordinateSpace.WORLD)
    fail("SplineComponent does not expose a world-location getter for validation")


def vector_distance(a, b):
    dx = a.x - b.x
    dy = a.y - b.y
    dz = a.z - b.z
    return (dx * dx + dy * dy + dz * dz) ** 0.5


def validate_spline_not_collapsed(spline_component, row):
    expected_start = point_to_vector(row["Points"][0])
    expected_end = point_to_vector(row["Points"][-1])
    expected_span = vector_distance(expected_start, expected_end)
    actual_start = spline_world_location_at_point(spline_component, 0)
    actual_end = spline_world_location_at_point(spline_component, len(row["Points"]) - 1)
    actual_span = vector_distance(actual_start, actual_end)
    if expected_span > 100.0 and actual_span < expected_span * 0.25:
        fail(
            f"Spline '{row.get('SplineKey')}' collapsed after configuration: "
            f"expected end-to-end span {expected_span:.1f} cm, got {actual_span:.1f} cm"
        )


def set_actor_tags(actor, row):
    tags = [
        "OSM_SPLINE",
        "CityStreet",
        row.get("Street", "") or row.get("SplineKey", ""),
        row.get("Type", ""),
        f"{float(row.get('WidthM', 0.0)):.2f}",
        row.get("SplineKey", ""),
        row.get("OsmClass", ""),
    ]
    if row.get("bBridge"):
        tags.append("Bridge")
    if row.get("bTunnel"):
        tags.append("Tunnel")
    set_tags(actor, tags)
    set_payload_if_present(actor, row, "OSM_SPLINE")


def create_street_spline_actor(actor_class, row):
    label = f"{ACTOR_LABEL_PREFIX}_{sanitize_label_part(row['SplineKey'])}"
    destroy_existing_actor_with_label(label)
    actor_location = point_to_vector(row["Points"][0])
    actor = unreal.EditorLevelLibrary.spawn_actor_from_class(
        actor_class,
        actor_location,
        unreal.Rotator(0.0, 0.0, 0.0),
    )
    if actor is None:
        fail(f"Failed to spawn actor '{label}'")
    actor.set_actor_label(label)
    spline_component = find_spline_component(actor)
    configure_spline_component(spline_component, row)
    validate_spline_not_collapsed(spline_component, row)
    set_actor_tags(actor, row)
    return actor


def create_building_actor(actor_class, row):
    label = f"{BUILDING_ACTOR_LABEL_PREFIX}_{sanitize_label_part(row.get('BuildingKey', row.get('Name', 'Building')))}"
    destroy_existing_actor_with_label(label)
    location = unreal.Vector(
        float(row["X"]) + WORLD_OFFSET_CM.x,
        float(row["Y"]) + WORLD_OFFSET_CM.y,
        float(row["Z"]) + WORLD_OFFSET_CM.z,
    )
    rotation = unreal.Rotator(roll=0.0, pitch=0.0, yaw=float(row.get("YawDeg", 0.0)))
    actor = unreal.EditorLevelLibrary.spawn_actor_from_class(actor_class, location, rotation)
    if actor is None:
        fail(f"Failed to spawn actor '{label}'")
    actor.set_actor_label(label)
    actor.set_actor_scale3d(
        unreal.Vector(
            max(0.01, float(row["WidthCm"]) / CUBE_BASE_CM),
            max(0.01, float(row["DepthCm"]) / CUBE_BASE_CM),
            max(0.01, float(row["HeightCm"]) / CUBE_BASE_CM),
        )
    )
    tags = [
        "OSM_BUILDING",
        "building",
        row.get("BuildingKey", ""),
        row.get("OsmId", ""),
        row.get("Name", ""),
        row.get("Type", ""),
        row.get("Address", ""),
    ]
    set_tags(actor, tags)
    set_payload_if_present(actor, row, "OSM_BUILDING")
    return actor


def create_tree_actor(actor_class, row):
    label = f"{TREE_ACTOR_LABEL_PREFIX}_{sanitize_label_part(row.get('TreeKey', row.get('Name', 'Tree')))}"
    destroy_existing_actor_with_label(label)
    location = unreal.Vector(
        float(row["X"]) + WORLD_OFFSET_CM.x,
        float(row["Y"]) + WORLD_OFFSET_CM.y,
        float(row.get("Z", 0.0)) + WORLD_OFFSET_CM.z,
    )
    actor = unreal.EditorLevelLibrary.spawn_actor_from_class(actor_class, location, unreal.Rotator(0.0, 0.0, 0.0))
    if actor is None:
        fail(f"Failed to spawn actor '{label}'")
    actor.set_actor_label(label)
    crown_scale = max(0.01, float(row.get("CrownDiameterCm", CUBE_BASE_CM)) / CUBE_BASE_CM)
    height_scale = max(0.01, float(row.get("HeightCm", CUBE_BASE_CM)) / CUBE_BASE_CM)
    actor.set_actor_scale3d(unreal.Vector(crown_scale, crown_scale, height_scale))
    tags = [
        "OSM_TREE",
        "tree",
        row.get("TreeKey", ""),
        row.get("OsmId", ""),
        row.get("Type", ""),
        row.get("HeightCm", ""),
        row.get("CrownDiameterCm", ""),
        row.get("Species", ""),
        row.get("LeafType", ""),
    ]
    set_tags(actor, tags)
    set_payload_if_present(actor, row, "OSM_TREE")
    return actor


def create_prop_actor(actor_class, row):
    label_name = row.get("DisplayName") or row.get("Name") or row.get("Type") or row.get("PropKey", "Prop")
    label = f"{PROP_ACTOR_LABEL_PREFIX}_{sanitize_label_part(label_name)}_{sanitize_label_part(row.get('OsmId', ''))}"
    destroy_existing_actor_with_label(label)
    location = unreal.Vector(
        float(row["X"]) + WORLD_OFFSET_CM.x,
        float(row["Y"]) + WORLD_OFFSET_CM.y,
        float(row.get("Z", 0.0)) + WORLD_OFFSET_CM.z,
    )
    yaw = float(row.get("Direction") or 0.0)
    actor = unreal.EditorLevelLibrary.spawn_actor_from_class(actor_class, location, unreal.Rotator(0.0, 0.0, yaw))
    if actor is None:
        fail(f"Failed to spawn actor '{label}'")
    actor.set_actor_label(label)
    height_scale = max(0.1, float(row.get("HeightCm", CUBE_BASE_CM)) / CUBE_BASE_CM)
    actor.set_actor_scale3d(unreal.Vector(0.25, 0.25, height_scale))
    tags = [
        "OSM_PROP",
        "prop",
        row.get("Category", ""),
        row.get("DisplayName", ""),
        row.get("PropKey", ""),
        row.get("OsmId", ""),
        row.get("Type", ""),
        row.get("Ref", ""),
        row.get("Address", ""),
    ]
    set_tags(actor, tags)
    set_payload_if_present(actor, row, "OSM_PROP")
    return actor


def main():
    bp_class_cache = {}
    point_count = 0
    for index, source_row in enumerate(STREET_SPLINES):
        row = require_spline(source_row, index)
        point_count += len(row["Points"])
        actor_class = bp_class_for_row(row, bp_class_cache)
        create_street_spline_actor(actor_class, row)
    building_actor_class = load_bp_class(BP_PATHS["building"]) if BUILDINGS else None
    for row in BUILDINGS:
        create_building_actor(building_actor_class, row)
    tree_actor_class = load_bp_class(BP_PATHS["tree"]) if TREES else None
    for row in TREES:
        create_tree_actor(tree_actor_class, row)
    prop_actor_class = load_bp_class(BP_PATHS["prop"]) if PROPS else None
    for row in PROPS:
        create_prop_actor(prop_actor_class, row)
    unreal.log(f"[INFO] Imported {len(STREET_SPLINES)} city street splines from {point_count} points, {len(BUILDINGS)} buildings, {len(TREES)} trees and {len(PROPS)} props")


main()
