-- DXG·PM Opener (D-168): "Open in Keynote" in DXG·PM hands this applet a dxgpm-open: link; the
-- work is done by open.sh, which accepts only DXG·PM's open links and presentation files.
on open location theURL
	try
		do shell script "/bin/bash " & quoted form of (POSIX path of (path to resource "open.sh")) & " " & quoted form of theURL
	on error errorMessage number errorNumber
		set why to "The presentation couldn't be opened."
		if errorNumber is 2 then set why to "That link isn't from DXG·PM, so it was not opened."
		if errorNumber is 3 then set why to "That isn't a presentation file, so it was not opened."
		if errorNumber is 5 then set why to "The file couldn't be fetched — the link lasts five minutes. Press Open in Keynote again."
		display dialog why & return & return & "You can always use Download on the page instead." buttons {"OK"} default button 1 with title "DXG·PM Opener" with icon caution
	end try
end open location

on run
	display dialog "DXG·PM Opener is ready on this Mac." & return & return & "In DXG·PM, press Open in Keynote: the browser asks to open DXG·PM Opener, and the presentation opens in this Mac's app for presentations (Keynote, LibreOffice or PowerPoint)." buttons {"OK"} default button 1 with title "DXG·PM Opener"
end run
