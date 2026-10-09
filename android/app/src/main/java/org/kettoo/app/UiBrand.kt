package org.kettoo.app

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.painter.BitmapPainter
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.imageResource
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp

val KettoBackground = Color(0xFFF6F4F1)

/** Show the original supplied artwork; crop its blank sheet only in the painter. */
@Composable
fun KettoBrand() {
    val artwork = ImageBitmap.imageResource(R.drawable.kettoo_logo)
    val painter = remember(artwork) {
        BitmapPainter(artwork, srcOffset = IntOffset(572, 724), srcSize = IntSize(940, 436))
    }
    Image(painter, "Kettoo", Modifier.width(100.dp).height(47.dp), contentScale = ContentScale.Fit)
}
