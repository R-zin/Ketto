# Current Android tokens
- Framework: Kotlin / Jetpack Compose; Material 3 from Compose BOM 2025.04.01.
- Theme: always light; primary black #000000, onPrimary white #FFFFFF, secondary DarkGray #444444, background #F8F8F7, surface white. Other Material values use lightColorScheme defaults.
- Surface accents: #F0F0F0 conversation/session panels; #E5E5E5 mode tabs; #E8E8E8 PTT ring/error panel; #E1E1E1 selected bottom-nav indicator; #F3F3F1 transcript panel.
- Body colors: black, DarkGray #444444, Gray #888888, LightGray #CCCCCC.
- Operational status colors: green #31755B, amber #936319; priority backgrounds #FFE6E1 / #FFF0D3 / #F0F0EF.
- Typography: default Material/Android font for body; FontFamily.Monospace for Tag and hold instruction. Tag is bold 10sp, uppercase, 1sp letter spacing. Body/context text varies 10-14sp; conversation title 21sp; brand 24sp; TALK 26sp; page headings 27-32sp.
- Shapes: RectangleShape for most buttons/fields/panels; CircleShape for conversation icon and TALK.
- Spacing: shell 20dp horizontal/top, settings 22dp, sign-in 23dp; common gaps 8/10/12/16/18/20dp. No shared spacing-token file.
- TALK: fixed 255dp diameter, 13dp ring, 13dp inner padding, microphone 49dp. Gesture-only press/release; no explicit control semantics.
- Shadows: no custom shadow/elevation system. No responsive breakpoints; fixed widths/sizes combined with Compose fill/weight/scroll.
- Icons: Material outlined icons; no CSS, Tailwind, custom fonts or standalone theme file for Android.

# Raw theme source
Exact MainActivity.onCreate theme provider follows. Full source and embedded component styling are in layouts.md and components.md.
Source: android/app/src/main/java/org/kettoo/app/MainActivity.kt

```kotlin
class MainActivity:ComponentActivity(){
    override fun onCreate(savedInstanceState:Bundle?){super.onCreate(savedInstanceState);setContent{MaterialTheme(colorScheme=lightColorScheme(primary=Color.Black,onPrimary=Color.White,secondary=Color.DarkGray,background=Color(0xFFF8F8F7),surface=Color.White)){KettooUI(application as KettooApplication)}}}
    override fun onResume(){super.onResume();val app=application as KettooApplication;app.inForeground=true;app.media.visible(true)}
    override fun onPause(){val app=application as KettooApplication;app.inForeground=false;if(!app.hardware.held)app.media.release();app.speech.stopDictation();app.media.visible(false);super.onPause()}
    override fun onKeyDown(keyCode:Int,event:KeyEvent):Boolean=if((application as KettooApplication).hardware.key(event))true else super.onKeyDown(keyCode,event)
    override fun onKeyUp(keyCode:Int,event:KeyEvent):Boolean=if((application as KettooApplication).hardware.key(event))true else super.onKeyUp(keyCode,event)
}
```

