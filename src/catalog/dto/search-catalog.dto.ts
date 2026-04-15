import { IsString, IsNotEmpty, Length, Matches } from 'class-validator';
import { Transform } from 'class-transformer';

export class SearchCatalogDto {
  @IsString()
  @IsNotEmpty()
  q: string;

  @IsString()
  @Length(2, 2)
  @Matches(/^[A-Z]{2}$/, { message: 'region must be ISO-3166 alpha-2' })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.toUpperCase() : value,
  )
  region: string;
}
